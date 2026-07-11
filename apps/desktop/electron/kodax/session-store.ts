// Session store — FEATURE_038 (v0.1.6).
//
// 包装 KodaX SDK 的 @kodax-ai/kodax/session subpath，把 Space 的 main 端
// fork/rewind/list 接到磁盘持久化。F033 in-memory 实现保留为 in-flight session 的
// runtime layer——这层只管已写盘的 historical sessions + 改盘操作。
//
// 设计：
//   - 所有 SDK 函数 NEVER throw（按 sdk-session.d.ts 注释保证）；本层不再包 try/catch
//     里多余的 envelope——直接把 null / error 转译成 host.ts 期望的形态
//   - watchSessions 通过 push channel 派发到 renderer，让 sidebar 自动刷新
//
// 与 F033 in-memory 的关系（host.ts 合并）：
//   list  → SDK listSessions + in-memory in-flight（in-flight 同名优先；运行时设置 full-detail）
//   fork  → SDK forkSession 出新 sessionId；新 sessionId 由 host 加进 in-memory map
//   rewind→ SDK rewindSession（持久化截断）+ host cancel in-flight (await)

// FEATURE_038 测试 DI：
//
// SDK session 函数是模块级单例（FileSessionStorage 读 KODAX_SESSIONS_DIR 模块加载
// 时定型，旧版 SDK 不能运行时改）——单元测试既不能注入自定义 sessionsDir，又不该
// 真去写 ~/.kodax/sessions/。所以本模块暴露一个可替换的 impl 引用：
//   - 生产代码不调 setSessionStoreImpl → 走真 SDK（首次调用时 dynamic import 拉起）
//   - 测试 beforeEach 调 setSessionStoreImpl(mock) → 注入 in-memory mock
//                                                  (避免 dynamic import 触发 cli-boxes JSON bug)
//
// 重置：setSessionStoreImpl(null) 恢复默认。
import type { Surface } from '@kodax-space/space-ipc-schema';
import { dedupeTranscriptEntries } from '../ipc/transcript-dedup.js';
import { getSessionTitleStore } from './session-title-store.js';

type SdkSessionModule = typeof import('@kodax-ai/kodax/session');
type SessionManager = ReturnType<SdkSessionModule['createSessionManager']>;
type CompactSessionOptions = Parameters<SessionManager['compactSession']>[1];
export type PersistedSessionCompactionResult = Awaited<
  ReturnType<SessionManager['compactSession']>
>;

export const SPACE_EPHEMERAL_SESSION_TAG = 'space-ephemeral';

export function isEphemeralSessionTag(tag: string | undefined): boolean {
  return tag === SPACE_EPHEMERAL_SESSION_TAG || tag === 'quick-ask';
}

const DEFAULT_VISIBLE_SESSION_LIMIT = 200;
const MAX_PERSISTED_SESSION_SUMMARIES_TO_SCAN = 50_000;

function isVisibleInteractiveSession(summary: {
  readonly tag?: string;
  readonly runtimeInfo?: { readonly surface?: string };
}): boolean {
  return !isEphemeralSessionTag(summary.tag) && summary.runtimeInfo?.surface !== 'acp';
}

/**
 * F045: 把 SDK SessionSummary.tag（consumer 私有自由字符串）反推回 Space 的 surface。
 * 只有 tag==='partner' 归 Partner；其余（'code' / 未知值 / 历史无 tag）一律保守归 Coder。
 * 与写入侧 real-session.ts 的 `session.tag = this.surface` 对称。
 */
export function sdkTagToSurface(tag: string | undefined): Surface {
  return tag === 'partner' ? 'partner' : 'code';
}

export interface SessionStoreImpl {
  readonly listSessions: SdkSessionModule['listSessions'];
  readonly forkSession: SdkSessionModule['forkSession'];
  readonly rewindSession: SdkSessionModule['rewindSession'];
  readonly deleteSession: SdkSessionModule['deleteSession'];
  readonly loadSession: SdkSessionModule['loadSession'];
  readonly saveSession?: (
    id: string,
    data: NonNullable<Awaited<ReturnType<SdkSessionModule['loadSession']>>>,
  ) => Promise<boolean>;
  /**
   * FEATURE_246/0.7.51 — append-order full transcript across compaction islands
   * (for UI scrollback). Optional so older SDKs / test mocks that omit it fall
   * back to `loadSession` (active branch only). See {@link loadPersistedTranscript}.
   */
  readonly loadFullTranscript?: SdkSessionModule['loadFullTranscript'];
  readonly appendClientNotice?: SdkSessionModule['appendClientNotice'];
  readonly watchSessions: SdkSessionModule['watchSessions'];
  /** optional — mock impls can omit; default impl wires via createSessionManager when present. */
  readonly createSessionManager?: SdkSessionModule['createSessionManager'];
  readonly compactSession?: SessionManager['compactSession'];
}

// 生产路径：lazy 加载 SDK 模块。第一次某个 default 包装被调时才拉 SDK；
// 测试注入 mock 后永远不会触发这里。
let sdkModuleCache: SdkSessionModule | null = null;
async function loadSdkModule(): Promise<SdkSessionModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax/session');
  }
  return sdkModuleCache;
}

/**
 * SDK createSessionManager() 返回的 manager 含 `storage` 字段 (FileSessionStorage 实例)。
 * Space 在 runKodaX 时把这个 storage 传给 session.storage —— 否则 SDK 的
 * saveSessionSnapshot 静默 no-op，jsonl 不会落盘。Manager 是 singleton（共享底层 fs
 * 写队列），整个 Space 进程共用一个。
 *
 * 如果当前安装的 SDK 还没暴露 createSessionManager / storage handle（旧版），
 * getSessionStorageHandle() 返回 undefined，real-session 透传给 SDK 仍安全（行为
 * 退回为"不落盘"）。新版 SDK 一就位自动生效。
 */
let managerCache: SessionManager | null = null;
async function getManager(): Promise<SessionManager> {
  if (managerCache === null) {
    const sdk = await loadSdkModule();
    managerCache = sdk.createSessionManager();
  }
  return managerCache;
}

/**
 * real-session 调这个拿 storage handle 喂给 runKodaX。SDK 未暴露 createSessionManager
 * 时（旧版本）throw —— caller fallback 为 undefined，行为退回"不落盘"。
 */
export async function getSessionStorageHandle(): Promise<unknown> {
  try {
    const m = await getManager();
    // `storage` 字段在新版 SDK 才暴露；旧版没有该属性，cast 成 unknown 后访问让
    // typecheck 在两边都过。运行时安全——没有 storage 时返回 undefined，
    // real-session 透传给 SDK 走 no-storage 路径。
    return (m as unknown as { storage?: unknown }).storage;
  } catch (err) {
    console.warn(
      `[session-store] getSessionStorageHandle failed (SDK lacks createSessionManager?): ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

type StorageWithSave = {
  save: (id: string, data: unknown) => Promise<void>;
};

function hasStorageSave(value: unknown): value is StorageWithSave {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { save?: unknown }).save === 'function'
  );
}

const DEFAULT_IMPL: SessionStoreImpl = {
  listSessions: async (opts) => (await loadSdkModule()).listSessions(opts),
  forkSession: async (id, opts) => (await loadSdkModule()).forkSession(id, opts),
  rewindSession: async (id, opts) => (await loadSdkModule()).rewindSession(id, opts),
  deleteSession: async (id) => (await loadSdkModule()).deleteSession(id),
  loadSession: async (id) => (await loadSdkModule()).loadSession(id),
  saveSession: async (id, data) => {
    const storage = await getSessionStorageHandle();
    if (!hasStorageSave(storage)) return false;
    await storage.save(id, data);
    return true;
  },
  loadFullTranscript: async (id) => {
    const sdk = await loadSdkModule();
    // Guard against a spuriously-old SDK build without the method (never-throw contract).
    return typeof sdk.loadFullTranscript === 'function' ? sdk.loadFullTranscript(id) : null;
  },
  appendClientNotice: async (id, opts) => {
    const manager = await getManager();
    return typeof manager.appendClientNotice === 'function'
      ? manager.appendClientNotice(id, opts)
      : null;
  },
  compactSession: async (id, opts) => (await getManager()).compactSession(id, opts),
  createSessionManager: (opts?: { sessionsDir?: string }) => {
    // 默认 impl 路径返回 lazily — 但 caller (real-session) 通过 getSessionStorageHandle()
    // 拿 cached manager，不直接走这里。这条 entry 主要给测试 inject mock 用。
    if (!sdkModuleCache) throw new Error('SDK not loaded yet — call loadSdkModule first');
    return sdkModuleCache.createSessionManager(opts);
  },
  // watchSessions 不能 async（返回 { close }），需要立即同步拿到 close handle
  watchSessions: (cb) => {
    // lazy 加载下的妥协：用 stub close handle 占位；await 完成后真 close 路由到真实 watcher
    let realClose: (() => void) | null = null;
    let cancelled = false;
    void loadSdkModule().then((sdk) => {
      if (cancelled) return;
      const w = sdk.watchSessions(cb);
      realClose = w.close;
    });
    return {
      close: () => {
        cancelled = true;
        realClose?.();
      },
    };
  },
};

let activeImpl: SessionStoreImpl = DEFAULT_IMPL;

/** 测试用：注入 mock SDK 实现。生产代码不调。 */
export function setSessionStoreImpl(impl: SessionStoreImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
  clearPersistedSessionCache(); // 切 impl 必清缓存，避免 test 之间读到生产值
}

export interface PersistedSessionMeta {
  /** SDK session id */
  readonly sessionId: string;
  /** SDK title (always present; default 'Untitled' or first prompt) */
  readonly title: string;
  /** SDK message count */
  readonly msgCount: number;
  /** ISO date string when available */
  readonly createdAt?: string;
  /** workspaceRoot (= projectRoot) 若 SDK runtimeInfo 提供 */
  readonly projectRoot?: string;
  /** F045: 从 SDK summary.tag 反推的工作面归属（无 tag 归 'code'）。决定列表归属。 */
  readonly surface: Surface;
}

/**
 * 拉指定 projectRoot 下的 historical sessions（写盘的）。
 *
 * - opts.projectRoot 透传给 SDK 做 git-root scoping（SDK 自己负责正规化）
 * - scope 限制为 'user'——managed-task-worker 是子 agent 内部 session，不该在
 *   sidebar 当主对话显示
 * - limit 缺省 200——大于 F033 in-memory 的常见 100 量级，UI 翻滚也撑得住
 */
export async function listPersistedSessions(opts: {
  readonly projectRoot?: string;
  readonly limit?: number;
  readonly surface?: 'code' | 'partner';
}): Promise<PersistedSessionMeta[]> {
  // SDK 0.7.46 (FEATURE_219) 真修了 cross-project filter bug —— storage.ts:1259
  // 现在 `currentGitRoot = gitRoot ?? (hostCwd ? getGitRoot(hostCwd) : null)`,
  // **不再** fallback `getGitRoot(undefined)` → `process.cwd()`。Space 不传 hostCwd
  // 构造 storage,所以 caller 不传 projectRoot 时 currentGitRoot=null → SDK 自动
  // 走"扫所有 projectKey 目录"分支返回全量 (storage.ts:1281)。
  //
  // 配合 listSessions fast-path guard (scope=user && !gitRoot && !before &&
  // !includeArchived → storage.list(undefined,{limit})),Space 端不再需要塞
  // sentinel `before` date 强制 slow path —— SDK fast path 也对了。
  //
  // 历史:
  //   v0.1.9 早期: 加 includeArchived:true 绕 0.7.45 bug (Space 进程 cwd =
  //                KodaX-Space → fallback gitRoot → 只看到自家 session)
  //   d410032: 改用 `before: '2999-...'` 触发 slow path (0.7.46 fast-path 内
  //            仍 fallback hostCwd,只是从 process.cwd 改成 hostCwd ≈ undefined
  //            → 行为没变)
  //   本次: SDK 0.7.46 storage.list 加 `this.hostCwd ?` 守门,不传 hostCwd
  //         就 currentGitRoot=null 走全量 → workaround 彻底不需要,恢复纯净调用
  const requestedLimit = Math.max(
    1,
    Math.min(opts.limit ?? DEFAULT_VISIBLE_SESSION_LIMIT, MAX_PERSISTED_SESSION_SUMMARIES_TO_SCAN),
  );
  // KodaX 0.7.66 cannot filter listSessions by runtimeInfo.surface. Filtering a
  // 200-row result after the SDK limit lets ACP placeholder sessions consume the
  // entire result window. Scan a bounded set first, then apply Space visibility
  // and the caller's limit. The SDK project-scoped slow path already reads and
  // sorts the full project bucket before slicing, so this does not add disk I/O.
  const summaries = await activeImpl.listSessions({
    projectRoot: opts.projectRoot,
    scope: 'user',
    limit: MAX_PERSISTED_SESSION_SUMMARIES_TO_SCAN,
  });
  const visibleSummaries = summaries
    .filter(
      (summary) =>
        isVisibleInteractiveSession(summary) &&
        (opts.surface === undefined || sdkTagToSurface(summary.tag) === opts.surface),
    )
    .slice(0, requestedLimit);
  if (
    summaries.length >= MAX_PERSISTED_SESSION_SUMMARIES_TO_SCAN &&
    visibleSummaries.length < requestedLimit
  ) {
    console.warn(
      `[session-store] reached ${MAX_PERSISTED_SESSION_SUMMARIES_TO_SCAN} persisted summaries before finding ${requestedLimit} visible interactive sessions`,
    );
  }
  return Promise.all(
    visibleSummaries.map(async (s) => {
      const titleOverride = await getSessionTitleStore().read(s.id);
      return {
        sessionId: s.id,
        title: titleOverride ?? s.title,
        msgCount: s.msgCount,
        createdAt: s.createdAt,
        projectRoot: s.runtimeInfo?.workspaceRoot ?? s.runtimeInfo?.gitRoot,
        // F045: 不把 tag 下推给 SDK listSessions（仍按 projectRoot+scope 拉，避开 all-fetch
        // 致列表不全的历史回退坑 ②B）。这里反推 surface，main 端（host.listMerged）再 filter。
        surface: sdkTagToSurface(s.tag),
      };
    }),
  );
}

/**
 * 持久化 fork：写盘出一个新 sessionId 继承 source 的 lineage。
 *
 * 返回 null 当 source 不存在；否则 newSessionId + title。
 *
 * 注：SDK 内部根据 selector 切 lineage（v0.7.42 fork 用 active entry；selector 缺省
 * 为 active）。Space 的 forkPointTurnIdx 当前还没接 selector——v0.1.6 仅做"在
 * active entry 处 fork"，下一版本接 turn-precise selector。
 */
export async function forkPersistedSession(opts: {
  readonly sourceSessionId: string;
  readonly selector?: string;
  readonly title?: string;
}): Promise<{ readonly newSessionId: string; readonly title: string } | null> {
  const result = await activeImpl.forkSession(opts.sourceSessionId, {
    ...(opts.selector !== undefined ? { selector: opts.selector } : {}),
    title: opts.title,
  });
  if (!result) return null;
  // Fork 把 source session 的尾部消息可能复制走/留下；缓存里的 source data 可能过期。
  // 清掉 source 的缓存，下次 session.history 重读。
  invalidatePersistedSessionCache(opts.sourceSessionId);
  return {
    newSessionId: result.sessionId,
    title: result.data.title,
  };
}

/**
 * 持久化 rewind：把 session 倒回某个 selector。selector 缺省回退到前一个 user entry。
 *
 * 返回 true 当 SDK 成功 rewind（含 session 存在 + lineage 有 user entry 可退）；
 * 返回 false 当 sessionId 不存在或没有 entry 可退。
 *
 * 注意：SDK rewindSession NEVER throws；这层不包 try/catch。
 */
export async function rewindPersistedSession(opts: {
  readonly sessionId: string;
  readonly selector?: string;
}): Promise<boolean> {
  const data = await activeImpl.rewindSession(
    opts.sessionId,
    opts.selector !== undefined ? { selector: opts.selector } : undefined,
  );
  if (data !== null) {
    invalidatePersistedSessionCache(opts.sessionId); // 截断后旧 data 过期
  }
  return data !== null;
}

/**
 * 持久化删除。session 当前在跑（其他 KodaX 进程 hold 着）时返回 'busy'。
 *
 * 与 host.delete 区别：host.delete 是 dispose in-memory in-flight；这里是擦盘。
 * 通常调用顺序：host.delete (cancel + dispose) → deletePersistedSession (擦盘)。
 */
export async function deletePersistedSession(opts: {
  readonly sessionId: string;
}): Promise<'ok' | 'busy'> {
  const result = await activeImpl.deleteSession(opts.sessionId);
  if ('ok' in result) {
    invalidatePersistedSessionCache(opts.sessionId);
    return 'ok';
  }
  return 'busy';
}

/**
 * 立即压缩已持久化 session。SDK 0.7.58 的 compactSession 负责读取、摘要、重写 lineage；
 * Space 这里只做 DI 兼容与本地历史缓存失效。
 */
export async function compactPersistedSession(
  sessionId: string,
  options: CompactSessionOptions = {},
): Promise<PersistedSessionCompactionResult> {
  try {
    const result = activeImpl.compactSession
      ? await activeImpl.compactSession(sessionId, options)
      : {
          compacted: false,
          tokensBefore: 0,
          tokensAfter: 0,
          messages: [],
          reason: 'compact unavailable in injected session store',
        };
    if (result.compacted) invalidatePersistedSessionCache(sessionId);
    return result;
  } catch (err) {
    return {
      compacted: false,
      tokensBefore: 0,
      tokensAfter: 0,
      messages: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 读单 session 完整数据（messages + title + lineage 等）。
 *
 * **LRU 缓存** (alpha.2)：session.history IPC 在用户点回旧 session 时调，无缓存时每次
 * 重读完整 jsonl (几 MB)。LRU 5 个 session 上限——刚好覆盖"最近用过的几个 session 切来
 * 切去"场景。缓存条目在 deletePersistedSession / fork / rewind 时清掉，避免读到过期数据。
 *
 * 失效语义：进程内只看自身 mutation；其他进程 (KodaX CLI) 改写同一 session 后 Space 进程
 * 不知道——这是已有的约束 (Space 不监听 jsonl 文件变化)，缓存不放大此问题。
 *
 * 返回 null 当 sessionId 不存在。
 */
type LoadedSessionData = Awaited<ReturnType<SessionStoreImpl['loadSession']>>;
type AppendClientNoticeOptions = Parameters<SdkSessionModule['appendClientNotice']>[1];
type PersistedClientNoticeEntry = Awaited<ReturnType<SdkSessionModule['appendClientNotice']>>;

const LOAD_CACHE_MAX = 5;
const loadCache = new Map<string, LoadedSessionData>();

export async function loadPersistedSession(sessionId: string): Promise<LoadedSessionData | null> {
  const cached = loadCache.get(sessionId);
  if (cached !== undefined) {
    // LRU recency bump: 删后重 set 让 Map iteration 顺序刷新（Map insertion order = 最近使用）
    loadCache.delete(sessionId);
    loadCache.set(sessionId, cached);
    return cached;
  }
  const data = await activeImpl.loadSession(sessionId);
  if (data === null) return null;
  loadCache.set(sessionId, data);
  // Evict oldest 一直保持 <= MAX
  while (loadCache.size > LOAD_CACHE_MAX) {
    const oldestKey = loadCache.keys().next().value;
    if (oldestKey === undefined) break;
    loadCache.delete(oldestKey);
  }
  return data;
}

export async function retagPersistedSession(opts: {
  readonly sessionId: string;
  readonly tag: Surface;
}): Promise<boolean> {
  const data = await activeImpl.loadSession(opts.sessionId);
  if (data === null) return false;
  const saved = activeImpl.saveSession
    ? await activeImpl.saveSession(opts.sessionId, { ...data, tag: opts.tag })
    : false;
  if (saved) invalidatePersistedSessionCache(opts.sessionId);
  return saved;
}

export async function appendPersistedClientNotice(
  sessionId: string,
  options: AppendClientNoticeOptions,
): Promise<PersistedClientNoticeEntry | null> {
  if (!activeImpl.appendClientNotice) return null;
  try {
    const entry = await activeImpl.appendClientNotice(sessionId, options);
    if (entry !== null) invalidatePersistedSessionCache(sessionId);
    return entry;
  } catch (err) {
    console.warn(
      `[session-store] appendClientNotice failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * 读单 session 的**完整 append-order transcript**（跨压缩边界），供 UI 滚动区回放。
 *
 * 背景（修 "压缩后历史消失"）：`loadSession` 只返回 active 分支——SDK 压缩会把压缩点
 * 之前的 turn 切成 inactive lineage，active 分支只剩"摘要 + 压缩后"，于是用户切回旧
 * session 时压缩前的对话在滚动区里凭空消失。SDK 0.7.51 起暴露 `loadFullTranscript`
 * 专门给 UI 回放用：按 append 顺序返回每个 transcript 条目（含 inactive），active
 * 分支另放 `activeMessages`。这里优先用它，`messages` 即完整历史。
 *
 * 向后兼容：injected mock / 老 SDK 无 loadFullTranscript 时回退到 `loadSession`
 * （active-only，即旧行为，不会更差）。返回 null 当 session 不存在。
 */
type TranscriptData =
  | NonNullable<Awaited<ReturnType<NonNullable<SessionStoreImpl['loadFullTranscript']>>>>
  | NonNullable<LoadedSessionData>;

const transcriptCache = new Map<string, TranscriptData>();

export async function loadPersistedTranscript(sessionId: string): Promise<TranscriptData | null> {
  const cached = transcriptCache.get(sessionId);
  if (cached !== undefined) {
    transcriptCache.delete(sessionId);
    transcriptCache.set(sessionId, cached);
    return cached;
  }
  let data: TranscriptData | null = null;
  if (activeImpl.loadFullTranscript) {
    try {
      data = await activeImpl.loadFullTranscript(sessionId);
    } catch (err) {
      console.warn(
        `[session-store] loadFullTranscript failed, falling back to active branch: ${err instanceof Error ? err.message : String(err)}`,
      );
      data = null;
    }
  }
  // Fallback: full transcript unavailable (old SDK / mock) → active branch only.
  if (data === null) {
    data = await activeImpl.loadSession(sessionId);
  }
  if (data === null) return null;
  transcriptCache.set(sessionId, data);
  while (transcriptCache.size > LOAD_CACHE_MAX) {
    const oldestKey = transcriptCache.keys().next().value;
    if (oldestKey === undefined) break;
    transcriptCache.delete(oldestKey);
  }
  return data;
}

type TranscriptSelectorEntry = {
  readonly entryId?: unknown;
  readonly logicalId?: unknown;
  readonly active?: unknown;
  readonly type?: unknown;
  readonly summary?: unknown;
  readonly payload?: unknown;
  readonly message?: {
    readonly role?: unknown;
    readonly content?: unknown;
    readonly source?: unknown;
    readonly _source?: unknown;
    readonly synthetic?: unknown;
    readonly _synthetic?: unknown;
  } | null;
};

export async function findPersistedTurnEndSelector(
  sessionId: string,
  turnIndex: number,
): Promise<string | null> {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) return null;
  const data = await loadPersistedTranscript(sessionId);
  if (data === null) return null;
  const rawEntries = (data as { readonly transcriptEntries?: unknown }).transcriptEntries;
  if (!Array.isArray(rawEntries)) return null;
  const dedupedEntries = dedupeTranscriptEntries(rawEntries as readonly TranscriptSelectorEntry[]);
  const hasActiveBranchMarkers = rawEntries.some(
    (entry) => entry && typeof entry === 'object' && (entry as { readonly active?: unknown }).active === true,
  );
  const entries = hasActiveBranchMarkers
    ? dedupedEntries.filter((entry) => entry.active === true)
    : dedupedEntries;

  let currentTurn = -1;
  let candidate: string | null = null;
  for (const entry of entries) {
    if (isRealUserPromptEntry(entry)) {
      if (currentTurn === turnIndex) return candidate;
      currentTurn += 1;
      candidate = entryIdOf(entry);
      continue;
    }
    if (currentTurn === turnIndex && isSelectableMessageEntry(entry)) {
      candidate = entryIdOf(entry);
    }
  }
  return currentTurn === turnIndex ? candidate : null;
}

function entryIdOf(entry: TranscriptSelectorEntry): string | null {
  return typeof entry.entryId === 'string' && entry.entryId.length > 0 ? entry.entryId : null;
}

function isSelectableMessageEntry(entry: TranscriptSelectorEntry): boolean {
  return (
    entry.type === 'message' &&
    entryIdOf(entry) !== null &&
    entry.message !== null &&
    entry.message !== undefined
  );
}

function isRealUserPromptEntry(entry: TranscriptSelectorEntry): boolean {
  if (entry.type !== 'message') return false;
  const msg = entry.message;
  if (msg === null || msg === undefined || msg.role !== 'user') return false;
  const source = msg.source ?? msg._source;
  if (source === 'sidecar-verifier') return false;
  if (msg.synthetic === true || msg._synthetic === true) return false;
  return entryIdOf(entry) !== null && extractPromptText(msg.content).trim().length > 0;
}

function extractPromptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if ((block as { readonly type?: unknown }).type !== 'text') continue;
    const chunk = (block as { readonly text?: unknown }).text;
    if (typeof chunk === 'string') text += chunk;
  }
  return text;
}

/** Mutator 调用——deletePersistedSession / fork / rewind 后清对应缓存项。*/
export function invalidatePersistedSessionCache(sessionId: string): void {
  loadCache.delete(sessionId);
  transcriptCache.delete(sessionId);
}

/** 测试 / setStorageImpl 注入 mock 后清整张缓存。*/
export function clearPersistedSessionCache(): void {
  loadCache.clear();
  transcriptCache.clear();
}

/**
 * 监听 sessions 目录变更——文件 add / remove / change。回调里通常调
 * pushToRenderer('session.list-changed') 让 renderer 重拉 list。
 *
 * NEVER throws；返回的 close() 可幂等调用。
 */
export function watchPersistedSessions(
  callback: (event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void,
): { close: () => void } {
  return activeImpl.watchSessions(callback);
}

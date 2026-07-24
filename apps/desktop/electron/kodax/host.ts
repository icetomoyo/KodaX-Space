// KodaXHost — main 进程的 session 容器单例。
//
// 职责：
//   - 维护 Map<sessionId, ManagedSession>
//   - createSession(...) 用注入的 SessionFactory 生成实例（Mock / Real 都走这个口）
//   - 所有 session 事件通过 emit() 统一走 pushToRenderer('session.event', ...)
//   - 提供查询 / 取消 / 删除接口给 IPC handler 用
//
// 当前默认 factory：MockKodaXSession（F003 阶段）。
// 后续 chore：加 RealKodaXSession 实现并由配置开关切换。

import { randomUUID } from 'node:crypto';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { permissionBroker } from '../permission/broker.js';
import { askUserBroker } from '../permission/ask-user-broker.js';
import type { ManagedSession, PermissionRequestFn, SessionFactory } from './session-adapter.js';
import { MockKodaXSession } from './mock-session.js';
import { RealKodaXSession } from './real-session.js';
import {
  listPersistedSessions,
  forkPersistedSession,
  rewindPersistedSession,
  deletePersistedSession,
  loadPersistedSession,
  compactPersistedSession,
  findPersistedTurnEndSelector,
  retagPersistedSession,
  sdkTagToSurface,
  invalidatePersistedSessionListCache,
} from './session-store.js';
import {
  loadKodaxCustomProviders,
  loadKodaxUserDefaults,
  registerKodaxCustomProviders,
  type KodaxConfigCustomProvider,
} from './user-config.js';
import { resolveRuntimeDefaults } from './runtime-defaults.js';
import { getSessionRuntimeStore } from './session-runtime-store.js';
import { getSessionTitleStore } from './session-title-store.js';
import { providerConfigStore } from '../providers/config.js';
import { getBuiltin } from '../providers/catalog.js';
import { cleanupClipboardForSession } from '../ipc/clipboard.js';
import { runtimeHostAdapter } from './runtime-host-adapter.js';

// alpha.2: Real KodaX 内核 vs Mock 切换。
//
// 规则：
//   - provider === 'mock'           → 始终走 Mock (F003 演示路径)
//   - 其他 (anthropic/zhipu-coding/kimi-code/deepseek-v4/ark-coding/...) → 默认走 Real
//   - env KODAX_FORCE_MOCK=1        → 强制全部 Mock（测试 / 离线开发）
//
// 这跟 user 实际工作流对齐：用户已在本地配好 ZHIPU_API_KEY / KIMI_API_KEY 等 env，
// 起 provider != 'mock' 就直接接 KodaX runtime；想 demo / 开发 UI 选 'mock' 走脚本流。
const FORCE_MOCK = process.env.KODAX_FORCE_MOCK === '1';

const defaultFactory: SessionFactory = (opts) => {
  if (FORCE_MOCK || opts.provider === 'mock') {
    return new MockKodaXSession(opts);
  }
  return new RealKodaXSession(opts);
};

/**
 * 临时 title 生成：剥不可见字符 → 折叠空白 → 按 Unicode scalar 切到 50 字。
 * F008 时升级成"用 cheap LLM 给一个 ≤ 8 字总结"。
 */
function autoTitleFromPrompt(prompt: string): string {
  return sanitizeTitle(prompt, 50);
}

/** F033: fork 时剥末尾 ` (fork)` 后缀，避免连续 fork 累积成 "X (fork) (fork) (fork)"。*/
function stripForkSuffix(title: string): string {
  // 用 while 处理连续多个后缀的历史脏数据
  let out = title;
  while (out.endsWith(' (fork)')) {
    out = out.slice(0, -' (fork)'.length);
  }
  return out;
}

export function providerDescriptor(
  providerId: string,
  kodaxCustomProviders: readonly KodaxConfigCustomProvider[] = [],
): { readonly defaultModel: string; readonly models?: readonly string[] } | undefined {
  const builtin = getBuiltin(providerId);
  if (builtin) return builtin;
  const custom = providerConfigStore.getCustom(providerId);
  if (custom) return custom;
  return kodaxCustomProviders.find((provider) => provider.id === providerId);
}

/**
 * Resolve the concrete model Space must persist and pass to Runtime-owned
 * services. The main provider can tolerate an omitted model by applying its
 * own default, but side services such as the Auto LLM classifier require the
 * effective model to be explicit.
 */
export function resolveEffectiveProviderModel(
  providerId: string,
  model?: string,
  kodaxCustomProviders: readonly KodaxConfigCustomProvider[] = [],
): string | undefined {
  const explicitModel = model?.trim();
  if (explicitModel) return explicitModel;
  return providerDescriptor(providerId, kodaxCustomProviders)?.defaultModel;
}

export function modelBelongsToProvider(
  providerId: string,
  model: string,
  kodaxCustomProviders: readonly KodaxConfigCustomProvider[] = [],
): boolean {
  const descriptor = providerDescriptor(providerId, kodaxCustomProviders);
  if (!descriptor) return false;
  if (!descriptor.models || descriptor.models.length === 0) return true;
  return descriptor.defaultModel === model || descriptor.models.includes(model);
}

export function providerIsConfigured(
  providerId: string,
  kodaxCustomProviders: readonly KodaxConfigCustomProvider[],
): boolean {
  return (
    providerId === 'mock' || providerDescriptor(providerId, kodaxCustomProviders) !== undefined
  );
}

/**
 * 统一的 title 清洗 + 截断。
 * 公开给 setTitle 路径用——用户手工改名时也得过这一遍。
 *
 * 安全注意：
 *   - prompt 是 renderer-supplied 内容，可能含 RTL override (U+202E) 反转 UI 文本、
 *     零宽 joiner 让标题看似空白、控制字符破坏日志输出——这里统一剥。
 *   - 顺序关键：先剥控制/零宽/RTL，再 \s+ 折叠空白。BOM (U+FEFF) 同时属于"零宽"
 *     和 JS \s 集合——必须先剥，否则 \s+ 把 BOM 当成空格保留下来。
 *   - 用 Array.from(s) 而非 .slice 切——后者按 UTF-16 code unit 切，会把
 *     surrogate-pair emoji（如 🔥 U+1F525）切成半个，存进 string 后变成 invalid 编码。
 */
export function sanitizeTitle(input: string, maxLen: number): string {
  // 1. 剥控制字符 + RTL override + 零宽 + BOM

  const stripped = input.replace(
    /[\x00-\x1f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
    '',
  );

  // 2. 折叠空白（\s 含 \t \n \r 等）
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return 'Untitled';

  // 3. 按 Unicode scalar value 切（Array.from 把 surrogate pair 当一个元素）
  const scalars = Array.from(collapsed);
  if (scalars.length <= maxLen) return scalars.join('');
  return scalars.slice(0, maxLen - 3).join('') + '...';
}

/**
 * FEATURE_038 合并视图项：in-flight 来自 in-memory runtime ManagedSession；
 * persisted 来自 SDK listSessions（只有 SDK 给的字段，无 Space 运行时设置）。
 *
 * IPC handler 自己负责把这两种 shape 投影成 SessionMeta（persisted 用 default
 * 运行时设置占位）——分两种 kind 让 handler 知道哪些字段是真的、哪些是占位。
 */
export type ListMergedItem =
  | {
      readonly kind: 'in-flight';
      readonly sessionId: string;
      readonly projectRoot: string;
      readonly provider: string;
      readonly reasoningMode: ManagedSession['reasoningMode'];
      readonly permissionMode: ManagedSession['permissionMode'];
      readonly autoModeEngine: ManagedSession['autoModeEngine'];
      readonly agentMode: ManagedSession['agentMode'];
      /** F045: 工作面归属（来自 runtime ManagedSession.surface）。*/
      readonly surface: ManagedSession['surface'];
      /** v0.7.42 wired: 用户 /model 设的值（undefined = provider 默认）。*/
      readonly model?: string;
      /** v0.7.42 wired: 用户 /thinking 设的值（undefined = KodaX 默认）。*/
      readonly thinking?: boolean;
      readonly title?: string;
      readonly createdAt: number;
      readonly lastActivityAt: number;
      readonly parentSessionId?: string;
      readonly forkPointTurnIdx?: number;
    }
  | {
      readonly kind: 'persisted';
      readonly sessionId: string;
      readonly title: string;
      readonly msgCount: number;
      readonly createdAt?: string;
      readonly projectRoot?: string;
      /** F045: 从 SDK summary.tag 反推的工作面归属（无 tag 归 'code'）。*/
      readonly surface: ManagedSession['surface'];
    };

class KodaXHost {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly runtimeMutationLocks = new Map<string, Promise<void>>();
  private readonly runtimeMutationsInProgress = new Set<string>();
  private factory: SessionFactory = defaultFactory;

  /**
   * 覆盖默认 factory——测试用 Mock 工厂注入预制行为。
   * 传 null 恢复默认（测试 afterEach 用，避免污染后续 case）。
   */
  setFactory(factory: SessionFactory | null): void {
    this.factory = factory ?? defaultFactory;
  }

  /** 生成 session。返回 sessionId 与 createdAt。
   *
   * existingSessionId：tryResume 用 — 传入磁盘上已有的 sessionId，让本次创建的
   * RealKodaXSession 直接接管它（SDK 内部按 session.id 匹配自动 resume lineage）。
   * 外部 IPC 入口不应直接传——只走 tryResume。
   */
  createSession(opts: {
    projectRoot: string;
    provider: string;
    reasoningMode?: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
    permissionMode?: import('@kodax-space/space-ipc-schema').PermissionMode;
    autoModeEngine?: import('@kodax-space/space-ipc-schema').AutoModeEngine;
    /** 缺省 'ama'。SA 是接口并发受限的 fallback；与 KodaX SDK 默认一致。*/
    agentMode?: import('@kodax-space/space-ipc-schema').AgentMode;
    /** F045: 工作面（'code' = Coder / 'partner' = Partner）。缺省 'code'。持久化为 SDK session tag。*/
    surface?: import('@kodax-space/space-ipc-schema').Surface;
    /** Host-only temporary session hidden from normal lists until promoted. */
    ephemeral?: boolean;
    /** 生效 model（创建即带）。undefined = provider 默认。让 SDK 应用 per-model 能力。*/
    model?: string;
    /** FEATURE_033：fork 时由 host.fork 传入；外部调用 createSession 不应直接用。*/
    parentSessionId?: string;
    forkPointTurnIdx?: number;
    /** tryResume 专用：复用磁盘上的 sessionId 而非生成新的。*/
    existingSessionId?: string;
  }): { sessionId: string; createdAt: number } {
    const surface = opts.surface ?? 'code';
    if (
      surface === 'code' &&
      runtimeHostAdapter.selectedHost() === 'legacy' &&
      !runtimeHostAdapter.hasLegacyOwner()
    ) {
      throw new Error('Space cannot create an inline Coder session without the owner fence.');
    }
    const sessionId = opts.existingSessionId ?? `s_${randomUUID()}`;
    const effectiveModel = resolveEffectiveProviderModel(opts.provider, opts.model);
    const session = this.factory({
      sessionId,
      projectRoot: opts.projectRoot,
      provider: opts.provider,
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      reasoningMode: opts.reasoningMode ?? 'auto',
      // FEATURE_029: canonical 缺省 'accept-edits' — 与 sessionMetaSchema.default 同步
      permissionMode: opts.permissionMode ?? 'accept-edits',
      autoModeEngine: opts.autoModeEngine ?? 'llm',
      agentMode: opts.agentMode ?? 'ama',
      surface,
      ephemeral: opts.ephemeral ?? false,
      parentSessionId: opts.parentSessionId,
      forkPointTurnIdx: opts.forkPointTurnIdx,
      emit: (event: SessionEvent) => {
        // 统一从 host 这里 push——session 实现不直接知道 renderer 存在
        pushToRenderer('session.event', event);
      },
      requestPermission: async (req: Parameters<PermissionRequestFn>[0]) => {
        // F007 permission gate：session 实现调用前转 broker，broker 推 IPC 弹窗给 renderer
        // alpha.1：把当前 session 的 permissionMode 一起传——broker 据此做 mode-aware 短路。
        // 从 sessions Map 现取（session.setPermissionMode 改字段后立即生效，无需重建）。
        const current = this.sessions.get(sessionId);
        const resolved = await permissionBroker.request({
          sessionId,
          toolId: req.toolId,
          toolName: req.toolName,
          input: req.input,
          mode: current?.permissionMode,
          surface: req.surface ?? current?.surface,
          partnerToolAllowed: req.partnerToolAllowed,
        });
        return resolved.decision;
      },
    });
    this.sessions.set(sessionId, session);
    return { sessionId, createdAt: session.createdAt };
  }

  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Persist the complete runtime identity after a successful user-visible mutation. */
  async persistRuntime(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    await providerConfigStore.load().catch(() => undefined);
    const kodaxCustomProviders = await loadKodaxCustomProviders().catch(() => []);
    const effectiveModel = resolveEffectiveProviderModel(
      session.provider,
      session.model,
      kodaxCustomProviders,
    );
    return getSessionRuntimeStore().set(sessionId, {
      provider: session.provider,
      model: effectiveModel,
      thinking: session.thinking,
      reasoningMode: session.reasoningMode,
      permissionMode: session.permissionMode,
      autoModeEngine: session.autoModeEngine,
      agentMode: session.agentMode,
    });
  }

  async commitRuntimeMutation(
    sessionId: string,
    mutate: () => boolean,
  ): Promise<'ok' | 'session-not-found' | 'persist-failed'> {
    let outcome: 'ok' | 'session-not-found' | 'persist-failed' = 'session-not-found';
    const previous = this.runtimeMutationLocks.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        outcome = await this.commitRuntimeMutationUnlocked(sessionId, mutate);
      });
    this.runtimeMutationLocks.set(sessionId, current);
    try {
      await current;
    } finally {
      if (this.runtimeMutationLocks.get(sessionId) === current) {
        this.runtimeMutationLocks.delete(sessionId);
      }
    }
    return outcome;
  }

  private async commitRuntimeMutationUnlocked(
    sessionId: string,
    mutate: () => boolean,
  ): Promise<'ok' | 'session-not-found' | 'persist-failed'> {
    const session = this.sessions.get(sessionId);
    if (!session) return 'session-not-found';
    const before = {
      provider: session.provider,
      model: session.model,
      thinking: session.thinking,
      reasoningMode: session.reasoningMode,
      permissionMode: session.permissionMode,
      autoModeEngine: session.autoModeEngine,
      agentMode: session.agentMode,
    };
    const restore = (): void => {
      session.provider = before.provider;
      session.model = before.model;
      session.thinking = before.thinking;
      session.reasoningMode = before.reasoningMode;
      session.permissionMode = before.permissionMode;
      session.autoModeEngine = before.autoModeEngine;
      session.agentMode = before.agentMode;
    };
    try {
      this.runtimeMutationsInProgress.add(sessionId);
      const mutated = mutate();
      this.runtimeMutationsInProgress.delete(sessionId);
      if (!mutated) {
        restore();
        return 'session-not-found';
      }
      const autoModeEngineChanged = before.autoModeEngine !== session.autoModeEngine;
      if (session.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()) {
        // A newly-created Space session is intentionally admitted to the daemon
        // lazily. Settings can be changed before the first send, so admit it here
        // as well and seed the complete settings snapshot instead of applying only
        // the one changed field to an otherwise-empty daemon session.
        await runtimeHostAdapter.updateSessionSettings(
          sessionId,
          {
            provider: session.provider,
            model: session.model ?? null,
            thinking: session.thinking ?? null,
            reasoningMode: session.reasoningMode,
            permissionMode: session.permissionMode,
            executionCwd: session.projectRoot,
            agentMode: session.agentMode,
            autoModeEngine: session.autoModeEngine,
          },
          {
            sessionId,
            projectRoot: session.projectRoot,
            surface: 'code',
            ephemeral: session.ephemeral === true,
          },
        );
      }
      if (await this.persistRuntime(sessionId)) {
        if (autoModeEngineChanged) {
          pushToRenderer('session.event', {
            kind: 'auto_engine_change',
            sessionId,
            engine: session.autoModeEngine,
            reason: 'manual',
          });
        }
        return 'ok';
      }
      if (session.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()) {
        const rollbackPatch = {
          ...(before.provider !== session.provider ? { provider: before.provider } : {}),
          ...(before.model !== session.model ? { model: before.model ?? null } : {}),
          ...(before.thinking !== session.thinking ? { thinking: before.thinking ?? null } : {}),
          ...(before.reasoningMode !== session.reasoningMode
            ? { reasoningMode: before.reasoningMode }
            : {}),
          ...(before.permissionMode !== session.permissionMode
            ? { permissionMode: before.permissionMode }
            : {}),
          ...(before.agentMode !== session.agentMode ? { agentMode: before.agentMode } : {}),
          ...(before.autoModeEngine !== session.autoModeEngine
            ? { autoModeEngine: before.autoModeEngine }
            : {}),
        };
        await runtimeHostAdapter
          .updateSessionSettings(sessionId, rollbackPatch)
          .catch(() => undefined);
      }
      restore();
      return 'persist-failed';
    } catch (error) {
      this.runtimeMutationsInProgress.delete(sessionId);
      restore();
      console.warn(
        `[host.commitRuntimeMutation] persist failed for ${sessionId}:`,
        error instanceof Error ? error.message : error,
      );
      return 'persist-failed';
    }
  }

  /**
   * Lazy resume：把磁盘上已经 persisted 但 main 进程 in-flight Map 里没有的 session
   * 重新装回 runtime。用户场景：重启 Space 后从 sidebar Recents 点开 "你好" → 想继续。
   *
   *   - 已 in-flight → 直接 return true，no-op
   *   - 磁盘上有 → 重建 RealKodaXSession 用同一 sessionId（SDK 内部按 id 接续 lineage）
   *   - 都没有 → return false（caller 应当报 session not found）
   *
   * Runtime defaults（provider / reasoningMode / permissionMode / agentMode）从：
   *   - ~/.kodax/config.json (KodaX user defaults)
   *   - provider 配置 store 的 defaultProviderId
   * 拉。当前 SDK 持久化的 jsonl 不存这些 runtime field（只存 lineage + gitRoot），
   * 重启后 resume 只能近似——provider/effort 用当前 defaults 而非历史值。
   * 这是 v0.1.x trade-off；要精确还原，得 SDK 把 runtime 设置也落盘。
   */
  async tryResume(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    const data = await loadPersistedSession(sessionId);
    if (!data) return false;
    // SDK loadSession 返回的对象 top-level 有 gitRoot；runtimeInfo 可能在嵌套字段。
    // 兜底处理两种 shape。
    const rec = data as unknown as {
      gitRoot?: string;
      tag?: string;
      runtimeInfo?: { workspaceRoot?: string; gitRoot?: string };
    };
    const projectRoot = rec.runtimeInfo?.workspaceRoot ?? rec.runtimeInfo?.gitRoot ?? rec.gitRoot;
    if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
      console.warn(`[host.tryResume] persisted session ${sessionId} lacks gitRoot — cannot resume`);
      return false;
    }
    const persistedRuntime = await getSessionRuntimeStore().read(sessionId);
    // Resolve current defaults only as the explicit fallback for legacy sessions.
    let fallbackProvider = 'mock';
    let configuredModel: string | undefined;
    let configuredThinking: boolean | undefined;
    try {
      const ud = await loadKodaxUserDefaults();
      if (ud.provider) fallbackProvider = ud.provider;
      if (ud.model) configuredModel = ud.model;
      configuredThinking = ud.thinking;
    } catch {
      // Use hard-coded defaults.
    }
    try {
      await providerConfigStore.load();
      const defaultId = providerConfigStore.getDefaultProviderId();
      if (defaultId) fallbackProvider = defaultId;
    } catch {
      // Use the KodaX user default or mock.
    }
    const kodaxCustomProviders = await loadKodaxCustomProviders().catch(() => []);
    const persistedProvider = persistedRuntime?.provider;
    const usePersistedIdentity =
      persistedProvider !== undefined &&
      providerIsConfigured(persistedProvider, kodaxCustomProviders);
    if (persistedProvider !== undefined && !usePersistedIdentity) {
      console.warn(
        `[host.tryResume] persisted provider "${persistedProvider}" is no longer configured; using current defaults`,
      );
    }
    const provider =
      usePersistedIdentity && persistedProvider !== undefined
        ? persistedProvider
        : fallbackProvider;
    if (provider !== 'mock' && !getBuiltin(provider)) {
      await registerKodaxCustomProviders(providerConfigStore.listCustom());
    }
    const runtimeDefaults = await resolveRuntimeDefaults({
      sessionId,
      includeSessionSidecar: true,
    });
    const requestedModel = usePersistedIdentity
      ? (persistedRuntime?.model ??
        providerDescriptor(provider, kodaxCustomProviders)?.defaultModel)
      : configuredModel;
    const model =
      requestedModel && modelBelongsToProvider(provider, requestedModel, kodaxCustomProviders)
        ? requestedModel
        : undefined;
    if (requestedModel && model === undefined) {
      console.warn(
        `[host.tryResume] ignoring model "${requestedModel}" because it does not belong to provider "${provider}"`,
      );
    }
    // Persisted mock sessions still resume through the real adapter because mock
    // sessions do not attach to the SDK's on-disk lineage.
    this.createSession({
      projectRoot,
      provider,
      ...(model !== undefined ? { model } : {}),
      reasoningMode: runtimeDefaults.reasoningMode,
      permissionMode: runtimeDefaults.permissionMode,
      autoModeEngine: runtimeDefaults.autoModeEngine,
      agentMode: runtimeDefaults.agentMode,
      // F045: 从持久化的 SDK session tag 反推 surface——否则重启后 resume 的 Partner
      // session 会被默认成 Coder，in-flight 项又因 dedup 优先覆盖 persisted 项，整段
      // resumed 生命周期都串面（code-review MEDIUM）。无 tag 的历史 session 归 'code'。
      surface: sdkTagToSurface(rec.tag),
      existingSessionId: sessionId,
    });
    // 把 persisted title 同步到 ManagedSession，避免 list 里两边 title 不一致
    const reloaded = this.sessions.get(sessionId);
    if (reloaded) {
      const thinking = usePersistedIdentity ? persistedRuntime?.thinking : configuredThinking;
      if (thinking !== undefined) reloaded.thinking = thinking;
      const titleOverride = await getSessionTitleStore().read(sessionId);
      const persistedTitle = titleOverride ?? (data as { title?: string }).title;
      if (persistedTitle && reloaded.title === undefined) reloaded.title = persistedTitle;
    }
    if (!(await this.persistRuntime(sessionId))) {
      await reloaded?.dispose().catch(() => undefined);
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  /**
   * In-flight sessions（仍在 main 端跑的 runtime 实例）。
   * 内部用——`session.list` IPC handler 走 listMerged() 拿合并视图。
   */
  listInFlight(): readonly ManagedSession[] {
    return [...this.sessions.values()];
  }

  async promoteEphemeral(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    if (s.ephemeral !== true) return true;
    if (!(await this.persistRuntime(sessionId))) return false;
    if (!(await retagPersistedSession({ sessionId, tag: s.surface }))) return false;
    s.ephemeral = false;
    return true;
  }

  /**
   * FEATURE_038: 合并视图 — in-flight (in-memory) ∪ SDK persisted。
   * 同 sessionId 时 in-flight 优先（运行时设置 full-detail）；historical 仅有
   * SDK 给的字段，运行时设置（provider/permissionMode 等）用 default 占位。
   *
   * NEVER throws：SDK 函数本身 NEVER throws；本层不再包 try/catch。
   */
  async listMerged(opts?: {
    projectRoot?: string;
    surface?: ManagedSession['surface'];
    limit?: number;
  }): Promise<ListMergedItem[]> {
    const inFlight = this.listInFlight().filter((s) => s.ephemeral !== true);
    const inFlightIds = new Set(inFlight.map((s) => s.sessionId));
    const persisted = await listPersistedSessions({
      projectRoot: opts?.projectRoot,
      limit: opts?.limit,
      surface: opts?.surface,
    });

    const items: ListMergedItem[] = inFlight.map((s) => ({
      kind: 'in-flight',
      sessionId: s.sessionId,
      projectRoot: s.projectRoot,
      provider: s.provider,
      reasoningMode: s.reasoningMode,
      permissionMode: s.permissionMode,
      autoModeEngine: s.autoModeEngine,
      agentMode: s.agentMode,
      surface: s.surface,
      model: s.model,
      thinking: s.thinking,
      title: s.title,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      parentSessionId: s.parentSessionId,
      forkPointTurnIdx: s.forkPointTurnIdx,
    }));

    for (const p of persisted) {
      if (inFlightIds.has(p.sessionId)) continue; // in-flight wins
      items.push({
        kind: 'persisted',
        sessionId: p.sessionId,
        title: p.title,
        msgCount: p.msgCount,
        createdAt: p.createdAt,
        projectRoot: p.projectRoot,
        surface: p.surface,
      });
    }

    // F045: surface filter 在合并后统一做（in-flight 来自 runtime，persisted 来自 mapper
    // 反推的 tag）。不传 surface = 不过滤（含历史无 tag 的，向后兼容）。Partner 的
    // persisted fallback 可以向 SDK 下推精确 tag；Coder 仍在 Space 层反推，以保留无 tag 历史会话。
    if (opts?.surface !== undefined) {
      return items.filter((it) => it.surface === opts.surface);
    }
    return items;
  }

  async cancel(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    // 取消该 session 所有 pending permission 弹窗——否则用户看到的弹窗对的是已死的 session，
    // tool 实际不会再执行，按了"允许"也没用
    permissionBroker.cancelSession(sessionId, 'session_cancelled');
    // FEATURE_032：同样取消 askUser pending，否则 modal 残留
    askUserBroker.cancelSession(sessionId, 'session_cancelled');
    // KodaX 0.7.43 升级后 sidecar verifier 在 Worker 文字结束后才跑（3-10s），verifier 阶段
    // 不一定响应 abortSignal；某些 provider 的 fetch 也不响应 AbortController。两种情况都会让
    // `runKodaX` 的 await 在 cancel 之后仍长时间不返回 → session_complete / session_error 不
    // emit → renderer spinner 永远转。
    //
    // Stop is a UI control: report the terminal state before any SDK teardown
    // path gets a chance to block.
    const daemonCoder = s.surface === 'code' && runtimeHostAdapter.hasReadyRuntime();
    if (!daemonCoder) {
      pushToRenderer('session.event', {
        kind: 'session_error',
        sessionId,
        error: 'cancelled',
        category: 'cancelled',
        retriable: true,
      });
    }
    const cancelPromise = s.cancel().catch((err) => {
      console.warn(
        `[host.cancel] cancel ${sessionId} failed:`,
        err instanceof Error ? err.message : err,
      );
    });
    void cancelPromise;
    return true;
  }

  /**
   * 用户/handler 在 session 还没 title 时自动填一个——基于第一条 prompt。
   * 已有 title 不覆盖（即使是空字符串，也不当 truthy 处理：用户主动清空可能想要的状态）。
   */
  ensureTitle(sessionId: string, fromPrompt: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.title !== undefined) return;
    s.title = autoTitleFromPrompt(fromPrompt);
  }

  async setTitle(sessionId: string, title: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    // 用户手工改名也走清洗——schema 限制了 256 字符上限，这里再剥控制字符 + RTL override
    const cleaned = sanitizeTitle(title, 256);
    if (s) {
      s.title = cleaned;
      await getSessionTitleStore().set(sessionId, cleaned);
      invalidatePersistedSessionListCache();
      return true;
    }
    const persisted = await loadPersistedSession(sessionId);
    if (!persisted) return false;
    await getSessionTitleStore().set(sessionId, cleaned);
    invalidatePersistedSessionListCache();
    return true;
  }

  /** F008: 切 reasoning mode。不重启 session——新设置应用于下一条 prompt。*/
  setReasoningMode(sessionId: string, mode: ManagedSession['reasoningMode']): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.reasoningMode = mode;
    return true;
  }

  /** F008: 切 provider。不重启 session——下一条 prompt 走新 provider。*/
  setProvider(sessionId: string, providerId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    if (s.provider !== providerId) {
      s.model = resolveEffectiveProviderModel(providerId);
    }
    s.provider = providerId;
    return true;
  }

  /**
   * v0.7.42 wired (P0): 切 model 覆盖 provider 默认。不重启 session——下一条 prompt
   * 通过 runKodaX options.model 生效。传 undefined 清除 override 时立即物化 provider
   * 默认模型，避免 Runtime-owned side services 把“没有 override”误读成空模型。
   */
  setModel(sessionId: string, model: string | undefined): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const effectiveModel = resolveEffectiveProviderModel(s.provider, model);
    s.model =
      effectiveModel ?? (model === undefined && s.provider !== 'mock' ? s.model : undefined);
    return true;
  }

  /**
   * v0.7.42 wired (P0): 切 thinking 开关。不重启 session——下一条 prompt
   * 通过 runKodaX options.thinking 生效。传 undefined 走 KodaX 默认。
   */
  setThinking(sessionId: string, thinking: boolean | undefined): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.thinking = thinking;
    return true;
  }

  /**
   * /compact slash command: SDK 0.7.58 provides immediate persisted-session
   * compaction, so Space no longer spikes a fake token snapshot on the next turn.
   */
  async requestCompact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<{
    ok: boolean;
    compacted?: boolean;
    tokensBefore?: number;
    tokensAfter?: number;
    reason?: string;
  }> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, reason: `session not found: ${sessionId}` };

    const usesRuntime = s.surface === 'code' && runtimeHostAdapter.hasReadyRuntime();
    // Runtime-backed sessions emit their own revisioned lifecycle. The compatibility events below
    // are retained only for embedded/legacy sessions, which do not have a daemon observation.
    if (!usesRuntime) pushToRenderer('session.event', { kind: 'compact_start', sessionId });
    try {
      const compactInput = {
        provider: s.provider,
        ...(s.model !== undefined ? { model: s.model } : {}),
        ...(customInstructions?.trim() ? { customInstructions: customInstructions.trim() } : {}),
      };
      const result = usesRuntime
        ? await runtimeHostAdapter
            .compactSession({ sessionId, ...compactInput })
            .catch((err: unknown) => ({
              compacted: false,
              tokensBefore: 0,
              tokensAfter: 0,
              reason: err instanceof Error ? err.message : String(err),
            }))
        : await compactPersistedSession(sessionId, compactInput);
      if (!usesRuntime && result.compacted) {
        pushToRenderer('session.event', {
          kind: 'compact_stats',
          sessionId,
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
          source: 'manual',
          committed: true,
        });
      }
      return {
        ok: true,
        compacted: result.compacted,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    } finally {
      if (!usesRuntime) pushToRenderer('session.event', { kind: 'compact_end', sessionId });
    }
  }

  /**
   * FEATURE_029: 切 permission mode (canonical 3)。
   *
   * Daemon Coder：运行时设置提交给 KodaX Runtime，Runtime guardrail 在下一次具体 tool call
   * 重新读取，因此同一 turn 内也按新 mode / engine 决策。Embedded / Partner / legacy：
   * guardrail 仍是 run-scoped bootstrap，切换从下一轮 send 生效。
   *
   * v0.1.4 修复：之前这里 push 一条 session_error event 当"informational 提示"，
   * 但 session_error 是"session 结束"语义 —— ActivitySpinner 看到立即把 streaming
   * 标 false，spinner 消失（用户报告"改 mode 后 spinner 动画消失了"）。
   * 现在改由 renderer 侧 ModeSelector 在 setMode 成功后用 isStreaming 自己检测
   * 同一条件 + pushToast。main 端只做字段赋值，零事件副作用。
   */
  setPermissionMode(sessionId: string, mode: ManagedSession['permissionMode']): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.permissionMode = mode;
    return true;
  }

  /**
   * FEATURE_029: 切 auto-mode 子档 engine ('llm' | 'rules')。
   * 立即赋值到 session.autoModeEngine（即便当前不是 auto mode 也接受——
   * 用户先选 engine 再切 auto mode 是合法 UX）。
   *
   * F030 wire 后：guardrail 通过 onEngineChange callback 反向通知 host 该字段，
   * 此 setter 主要服务 user-initiated 切换 + emit 一条 auto_engine_change event 给 renderer。
   */
  setAutoModeEngine(sessionId: string, engine: ManagedSession['autoModeEngine']): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    if (s.autoModeEngine === engine) return true; // 幂等：相同值不 emit event
    s.autoModeEngine = engine;
    if (!this.runtimeMutationsInProgress.has(sessionId)) {
      pushToRenderer('session.event', {
        kind: 'auto_engine_change',
        sessionId,
        engine,
        reason: 'manual',
      });
    }
    return true;
  }

  /**
   * 切 agent 形态 (AMA ↔ SA)。
   * 立即赋值到 session.agentMode，下条 prompt 走新形态 (real-session 闭包 live-read)。
   * 不重启 in-flight session — 当前 turn 仍以旧形态完成。幂等：相同值直接返回。
   */
  setAgentMode(sessionId: string, agentMode: ManagedSession['agentMode']): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    if (s.agentMode === agentMode) return true;
    s.agentMode = agentMode;
    return true;
  }

  /**
   * FEATURE_038 (持久化): 从 sourceSessionId 在 forkPointTurnIdx 处 fork。
   *
   * 行为：
   *   1. SDK forkSession 写盘出新 sessionId（lineage 继承 active entry；v0.1.6 暂不
   *      接 turn-precise selector——SDK 0.7.43 加 selector 形态再升）
   *   2. 用 source 的运行时设置（provider/permissionMode 等）实例化新 ManagedSession
   *      入 in-memory map（成为 active session，可以继续 send / cancel）
   *   3. 新 ManagedSession 用 SDK 返回的 sessionId（保证盘 ↔ 内存一致）
   *
   * **source 必须是 in-flight**：v0.1.6 不支持对纯 historical session fork（要那样
   * 用户应先 select 让 session 加载到内存）。这是 F033 接 F038 后的合理限制——
   * 用户在 sidebar 点 historical session 之前 desktop 不知道它的运行时设置。
   *
   * Returns null 当 source 不在 in-memory，或 SDK fork 失败。
   */
  async fork(
    sourceSessionId: string,
    forkPointTurnIdx: number,
  ): Promise<{ newSessionId: string; createdAt: number } | null> {
    const src = this.sessions.get(sourceSessionId);
    if (!src) return null;

    const forkTitle = src.title !== undefined ? `${stripForkSuffix(src.title)} (fork)` : undefined;
    const selector = await findPersistedTurnEndSelector(sourceSessionId, forkPointTurnIdx);
    const sdkResult =
      src.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()
        ? await runtimeHostAdapter.forkSession({
            sessionId: sourceSessionId,
            ...(selector !== null ? { selector } : {}),
            ...(forkTitle !== undefined ? { title: forkTitle } : {}),
          })
        : await forkPersistedSession({
            sourceSessionId,
            ...(selector !== null ? { selector } : {}),
            title: forkTitle,
          });
    if (!sdkResult) return null; // SDK 找不到 source（盘上没记录），不视作错误（fork 一个未持久化的全新 session 是合法的）

    // 用 SDK 返回的 sessionId 实例化（不走 createSession 因为后者自己 randomUUID）
    const sessionId = 'newSessionId' in sdkResult ? sdkResult.newSessionId : sdkResult.id;
    const createdAt = Date.now();
    // reviewer HIGH-1：factory 可能抛（MockKodaXSession / RealKodaXSession 构造路径）。
    // SDK 已经写盘，但 factory 失败时 in-memory 实例缺失 → 盘上 orphan session。
    // 用 try/catch 回滚：擦盘后重抛，调用方拿到的是确定的失败状态。
    let session: ManagedSession;
    try {
      session = this.factory({
        sessionId,
        projectRoot: src.projectRoot,
        provider: src.provider,
        ...(src.model !== undefined ? { model: src.model } : {}),
        reasoningMode: src.reasoningMode,
        permissionMode: src.permissionMode,
        autoModeEngine: src.autoModeEngine,
        // review MEDIUM-4: 之前漏传 agentMode → fork child 总被重置成默认 'ama'（即便 source 是
        // 'sa'）。补上与其他运行时设置一致地继承 source。
        agentMode: src.agentMode,
        // F045: fork child 继承 source 的工作面——Coder fork 仍是 Coder，Partner fork 仍是 Partner。
        surface: src.surface,
        parentSessionId: sourceSessionId,
        forkPointTurnIdx,
        emit: (event: SessionEvent) => {
          pushToRenderer('session.event', event);
        },
        requestPermission: async (req: Parameters<PermissionRequestFn>[0]) => {
          const current = this.sessions.get(sessionId);
          const resolved = await permissionBroker.request({
            sessionId,
            toolId: req.toolId,
            toolName: req.toolName,
            input: req.input,
            mode: current?.permissionMode,
            surface: req.surface ?? current?.surface,
            partnerToolAllowed: req.partnerToolAllowed,
          });
          return resolved.decision;
        },
      });
    } catch (err) {
      // best-effort 回滚：擦掉刚写盘的 fork——失败也无所谓，下一次 list/cleanup 会发现
      if (src.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()) {
        await runtimeHostAdapter.deleteSession(sessionId).catch(() => undefined);
      } else {
        await deletePersistedSession({ sessionId }).catch(() => undefined);
      }
      throw err;
    }
    this.sessions.set(sessionId, session);
    session.thinking = src.thinking;
    session.title = forkTitle ?? session.title;
    if (!(await this.persistRuntime(sessionId))) {
      await session.dispose().catch(() => undefined);
      this.sessions.delete(sessionId);
      if (src.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()) {
        await runtimeHostAdapter.deleteSession(sessionId).catch(() => undefined);
      } else {
        await deletePersistedSession({ sessionId }).catch(() => undefined);
      }
      throw new Error('fork runtime metadata could not be persisted');
    }
    return { newSessionId: sessionId, createdAt };
  }

  /**
   * FEATURE_038 (持久化): 把 session 回退到 rewindPastTurnIdx。
   *
   * 行为：
   *   1. 验证 session 在 in-memory（v0.1.6 暂不支持对纯 historical session rewind——
   *      同 fork 限制，用户得先 select 让它加载到内存）
   *   2. cancel in-flight + pending permission/askUser（**必须 await**）
   *   3. SDK rewindSession 写盘截断（lineage active entry 退到前一个 user entry）
   *   4. 推回 lastActivityAt
   *
   * SDK rewindSession 返回 null 当：sessionId 在盘上不存在 OR lineage 没有更早的
   * user entry 可退。这两种 ambiguous 都映射成 ok:true（in-memory cancel 已做；
   * renderer 自己根据 idx 截 events）——v0.1.7+ 优化时再区分。
   *
   * Returns:
   *   ok: true                          in-memory cancel 完成
   *   ok: false, reason: 'session_not_found'
   */
  async rewind(
    sessionId: string,
    rewindPastTurnIdx: number,
  ): Promise<{
    ok: boolean;
    reason?: 'session_not_found' | 'invalid_index' | 'session_busy';
    /**
     * reviewer HIGH-3: 报告盘上 rewind 是否成功。
     * false 当 session 不在盘上 OR lineage 没有更早的 user entry 可退——in-flight
     * 已 cancel 但持久化未变更，renderer 应当提示用户"已暂停，但历史未截断"
     * 而非默默 truncate UI buffer。
     */
    diskRewound?: boolean;
  }> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, reason: 'session_not_found' };
    // cancel in-flight，避免 rewind 后还有迟来的 event 把截掉的位置塞回去
    permissionBroker.cancelSession(sessionId, 'session_cancelled');
    askUserBroker.cancelSession(sessionId, 'session_cancelled');
    // await cancel：确保 IPC ack 返回时 stream 已彻底终止，renderer 截 buffer 时不会有
    // late event 把截掉的内容再塞回去。cancel 通常是 ms 级。
    await s.cancel().catch(() => undefined);
    const selector = await findPersistedTurnEndSelector(sessionId, rewindPastTurnIdx);
    // 持久化截断（NEVER throws；不存在 / 无可退则 no-op；返回 false 让 renderer 知道）
    const diskRewound =
      s.surface === 'code' && runtimeHostAdapter.hasReadyRuntime()
        ? (await runtimeHostAdapter.rewindSession({
            sessionId,
            ...(selector !== null ? { selector } : {}),
          })) !== null
        : await rewindPersistedSession({
            sessionId,
            ...(selector !== null ? { selector } : {}),
          });
    s.lastActivityAt = Date.now();
    // forkPointTurnIdx 不变（rewind 不影响 fork 元数据）
    return { ok: true, diskRewound };
  }

  /**
   * FEATURE_038 (持久化): 删 session。三步走：
   *   1. cancel pending broker requests
   *   2. dispose in-memory runtime + 移出 Map（如有）
   *   3. SDK deleteSession 擦盘（如果 session 不在 in-memory，纯擦盘）
   *
   * **幂等**：SDK 返回 `ok`（包括磁盘上已不存在）时返回 true。若另一个 KodaX
   * 进程仍持有该 session，SDK 返回 `session_running`，这里必须返回 false：持久化
   * session 尚未删除，调用方也不得清理它的 runtime/title/notice 等 sidecar。
   */
  async delete(sessionId: string): Promise<boolean> {
    await this.runtimeMutationLocks.get(sessionId)?.catch(() => undefined);
    const s = this.sessions.get(sessionId);
    const persisted = s ? undefined : await loadPersistedSession(sessionId);
    const surface = s?.surface ?? sdkTagToSurface(persisted?.tag) ?? 'code';
    if (s) {
      permissionBroker.cancelSession(sessionId, 'session_disposed');
      askUserBroker.cancelSession(sessionId, 'session_disposed');
      await s.dispose();
      this.sessions.delete(sessionId);
    }
    // 持久化擦盘——即便 in-memory 不存在也尝试擦（用户对 historical session 直接删）
    const diskDeleteResult =
      surface === 'code' && runtimeHostAdapter.hasReadyRuntime()
        ? await runtimeHostAdapter
            .deleteSession(sessionId)
            .then((outcome) =>
              outcome === 'not_found'
                ? deletePersistedSession({ sessionId })
                : Promise.resolve('ok' as const),
            )
            .catch((error: unknown) => {
              console.warn(
                `[host.delete] Runtime rejected deletion for ${sessionId}:`,
                error instanceof Error ? error.message : String(error),
              );
              return 'session_running' as const;
            })
        : await deletePersistedSession({ sessionId });
    if (diskDeleteResult !== 'ok') {
      if (s) {
        const restored = await this.tryResume(sessionId).catch((error: unknown) => {
          console.warn(`[host.delete] failed to restore busy session ${sessionId}:`, error);
          return false;
        });
        if (!restored) {
          console.warn(`[host.delete] busy session ${sessionId} is no longer attached locally`);
        }
      }
      return false;
    }
    await getSessionTitleStore().delete(sessionId);
    // OC-31 v0.1.9: 清掉本 session 的 clipboard image 暂存目录（best-effort，
    // ENOENT 静默；KodaX SDK 已经把 image path 序列化进 message history 文本里，
    // 删图本身不影响 historical content，下次 resume 时 path 指向"已不存在"也只会
    // 让 SDK provider transport 跳过这张图，不会让整 turn fail）。
    await cleanupClipboardForSession(sessionId);
    return true;
  }

  /** 测试 / 关闭流程用：清空所有 session。*/
  async disposeAll(options?: { readonly detachRuntimeRuns?: boolean }): Promise<void> {
    await Promise.all(
      [...this.runtimeMutationLocks.values()].map((pending) => pending.catch(() => undefined)),
    );
    const sids = [...this.sessions.keys()];
    for (const sid of sids) {
      permissionBroker.cancelSession(sid, 'shutdown');
      askUserBroker.cancelSession(sid, 'shutdown');
    }
    await Promise.all(
      [...this.sessions.values()].map((s) =>
        s.dispose({ abortRuntimeRun: !(options?.detachRuntimeRuns ?? false) }),
      ),
    );
    this.sessions.clear();
    // OC-31 v0.1.9: 同 delete()，进程关掉时把所有 session 的 clipboard 暂存清掉
    await Promise.all(sids.map((sid) => cleanupClipboardForSession(sid)));
  }
}

// 单例。main.ts / handler / 测试都通过这个 instance 操作。
export const kodaxHost = new KodaXHost();

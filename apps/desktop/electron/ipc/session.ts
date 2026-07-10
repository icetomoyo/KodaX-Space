// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import {
  kodaxHost,
  modelBelongsToProvider,
  providerDescriptor,
  providerIsConfigured,
} from '../kodax/host.js';
import { projectStore } from '../projects/store.js';

// v0.1.5: canonProjectRoot 抽到 schema 包共享 util（renderer + main 同一实现），
// 修 F040/F041 review MED-3 的 normalize 不一致。
// IS_WIN 在 main 侧用 process.platform；renderer 同名函数用 navigator.userAgent。
import { canonProjectRoot as canonProjectRootShared } from '@kodax-space/space-ipc-schema';
const IS_WIN_MAIN = process.platform === 'win32';
function canonProjectRoot(p: string): string {
  return canonProjectRootShared(p, IS_WIN_MAIN);
}

export function assertSessionSendScope(
  session: {
    readonly sessionId: string;
    readonly projectRoot: string;
    readonly surface?: SessionMeta['surface'];
  },
  expected: {
    readonly expectedProjectRoot?: string;
    readonly expectedSurface?: SessionMeta['surface'];
  },
): void {
  if (
    expected.expectedProjectRoot !== undefined &&
    canonProjectRoot(session.projectRoot) !== canonProjectRoot(expected.expectedProjectRoot)
  ) {
    throw new Error(
      `session/project mismatch: session ${session.sessionId} is scoped to ${session.projectRoot}, not ${expected.expectedProjectRoot}`,
    );
  }

  const actualSurface = session.surface ?? 'code';
  if (expected.expectedSurface !== undefined && actualSurface !== expected.expectedSurface) {
    throw new Error(
      `session/surface mismatch: session ${session.sessionId} is scoped to ${actualSurface}, not ${expected.expectedSurface}`,
    );
  }
}
import { loadAgentsMd, type AgentsFile } from '../kodax/agents-md-loader.js';
import path from 'node:path';
import { getKodaxDir, getSpaceDataDir } from '../kodax/data-paths.js';
import {
  loadKodaxCustomProviders,
  loadKodaxUserDefaults,
  registerKodaxCustomProviders,
  type KodaxConfigCustomProvider,
} from '../kodax/user-config.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import { appendPersistedClientNotice, loadPersistedTranscript } from '../kodax/session-store.js';
import { parseTaskCompletedBlocks, selectWorkflowBlocks } from './workflow-result-notice.js';
import { dedupeTranscriptEntries } from './transcript-dedup.js';
import { resolveRuntimeDefaults } from '../kodax/runtime-defaults.js';
import { getSessionRuntimeStore } from '../kodax/session-runtime-store.js';
import { getSessionLocalNoticeStore } from '../kodax/session-local-notice-store.js';
import { assertArtifactPathInClipboardSandbox } from './clipboard.js';
import { clearSlashGoalForSession } from '../slash/builtin.js';
import { ensureProviderKeyInjected } from './provider.js';
import type {
  AgentsFileMeta,
  InputArtifact,
  SessionHistoryItem,
  SessionLocalNotice,
  SessionMeta,
} from '@kodax-space/space-ipc-schema';

export function resolveHistoricalRuntimeIdentity(input: {
  readonly persisted?: { readonly provider?: string; readonly model?: string };
  readonly fallbackProvider: string;
  readonly fallbackModel?: string;
  readonly kodaxCustomProviders?: readonly KodaxConfigCustomProvider[];
}): {
  readonly provider: string;
  readonly model?: string;
  readonly runtimeMetadataSource: 'persisted' | 'current-default-fallback';
} {
  const customProviders = input.kodaxCustomProviders ?? [];
  const persistedProvider = input.persisted?.provider;
  const providerIsValid =
    persistedProvider !== undefined && providerIsConfigured(persistedProvider, customProviders);
  const provider = providerIsValid ? persistedProvider : input.fallbackProvider;
  const requestedModel = providerIsValid
    ? (input.persisted?.model ?? providerDescriptor(provider, customProviders)?.defaultModel)
    : input.fallbackModel;
  const model =
    requestedModel && modelBelongsToProvider(provider, requestedModel, customProviders)
      ? requestedModel
      : undefined;
  const exact =
    providerIsValid &&
    (provider === 'mock' ||
      (input.persisted?.model !== undefined && model === input.persisted.model));
  return {
    provider,
    ...(model !== undefined ? { model } : {}),
    runtimeMetadataSource: exact ? 'persisted' : 'current-default-fallback',
  };
}

export interface SessionDeleteOperations {
  readonly deleteSession: (sessionId: string) => Promise<boolean>;
  readonly clearGoal: (sessionId: string) => void;
  readonly deleteRuntime: (sessionId: string) => Promise<void>;
  readonly deleteLocalNotices: (sessionId: string) => Promise<void>;
}

export async function deleteSessionForIpc(
  sessionId: string,
  operations: SessionDeleteOperations = {
    deleteSession: (id) => kodaxHost.delete(id),
    clearGoal: clearSlashGoalForSession,
    deleteRuntime: (id) => getSessionRuntimeStore().delete(id),
    deleteLocalNotices: (id) => getSessionLocalNoticeStore().delete(id),
  },
): Promise<{ deleted: boolean; reason?: 'session_running' }> {
  const deleted = await operations.deleteSession(sessionId);
  if (!deleted) return { deleted: false, reason: 'session_running' };
  operations.clearGoal(sessionId);
  await operations.deleteRuntime(sessionId);
  await operations.deleteLocalNotices(sessionId);
  return { deleted: true };
}

async function commitRuntimeMutationForIpc(
  sessionId: string,
  mutate: () => boolean,
): Promise<boolean> {
  const result = await kodaxHost.commitRuntimeMutation(sessionId, mutate);
  if (result === 'persist-failed') {
    throw new Error(
      `session runtime metadata could not be persisted; change was rolled back: ${sessionId}`,
    );
  }
  return result === 'ok';
}

// SDK lazy + cached import — 跟其他 SDK 接入点 (agent.ts, queue.ts, catalog.ts) 同模式。
// listRunningSessions handler 用; main 是 CJS,SDK subpath 是 ESM-only,必须动态 import 一次,
// 之后 module cache 直接返回 (审查 Batch 4 M1 consistency)。
type SdkSessionModule = typeof import('@kodax-ai/kodax/session');
let sdkSessionCache: SdkSessionModule | null = null;
async function loadSdkSessionCached(): Promise<SdkSessionModule> {
  if (sdkSessionCache === null) {
    sdkSessionCache = await import('@kodax-ai/kodax/session');
  }
  return sdkSessionCache;
}

type SdkMediaModule = Pick<
  typeof import('@kodax-ai/kodax/media'),
  'validateInputArtifactsForModel'
>;
let sdkMediaCache: SdkMediaModule | null = null;
async function loadSdkMediaCached(): Promise<SdkMediaModule> {
  if (sdkMediaCache === null) {
    sdkMediaCache = await import('@kodax-ai/kodax/media');
  }
  return sdkMediaCache;
}

async function validateInputArtifactsForSession(
  artifacts: readonly InputArtifact[] | undefined,
  session: { readonly provider: string; readonly model?: string },
): Promise<void> {
  if (!artifacts || artifacts.length === 0) return;
  const sdk = await loadSdkMediaCached();
  try {
    sdk.validateInputArtifactsForModel(artifacts, {
      provider: session.provider,
      ...(session.model ? { model: session.model } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`input artifact preflight failed: ${message}`);
  }
}

// FEATURE_034 reviewer MEDIUM-2: 编译期保证 loader 的 AgentsFile 与 schema 的 AgentsFileMeta
// 结构一致——加字段、改 scope enum 等都会立即编译报错，不让 schema/loader 漂移。
// (双向 assignability：a→b 和 b→a 都必须成立，等同于结构等价。)
// 用 export 让 tsc noUnusedLocals 不报错（type-only export 不影响 runtime）
export type _AssertAgentsFileShapeEqual = AgentsFile extends AgentsFileMeta
  ? AgentsFileMeta extends AgentsFile
    ? true
    : never
  : never;

/**
 * 校验 providerId 实际存在于 catalog / custom-providers / 是 'mock'。
 * review F008 C1-sec：schema 只验格式，不验存在性——必须 main 端再过一层。
 */
async function assertProviderExists(providerId: string): Promise<void> {
  if (providerId === 'mock') return;
  if (isBuiltinId(providerId)) return;
  await providerConfigStore.load();
  if (providerConfigStore.getCustom(providerId)) return;
  if ((await loadKodaxCustomProviders()).some((p) => p.id === providerId)) return;
  throw new Error('unknown providerId');
}

async function ensureCustomProviderRegistered(providerId: string): Promise<void> {
  if (providerId === 'mock' || isBuiltinId(providerId)) return;
  await providerConfigStore.load();
  await registerKodaxCustomProviders(providerConfigStore.listCustom());
}

export function registerSessionChannels(): void {
  // session.create
  registerChannel('session.create', async (input) => {
    const projectRoot = validateProjectRoot(input.projectRoot);
    await assertProviderExists(input.provider);
    await ensureCustomProviderRegistered(input.provider);
    await ensureProviderKeyInjected(input.provider);
    const runtimeDefaults = await resolveRuntimeDefaults({
      explicit: {
        reasoningMode: input.reasoningMode,
        permissionMode: input.permissionMode,
        autoModeEngine: input.autoModeEngine,
        agentMode: input.agentMode,
      },
    });
    const { sessionId, createdAt } = kodaxHost.createSession({
      projectRoot,
      provider: input.provider,
      // 生效 model（renderer 用 resolveActiveModel 解析后带上）→ 让 SDK 应用 per-model 能力
      // （正确 contextWindow → 压缩窗口），修默认模型下过早压缩（2026-06-15 用户复报）。
      ...(input.model !== undefined ? { model: input.model } : {}),
      reasoningMode: runtimeDefaults.reasoningMode,
      permissionMode: runtimeDefaults.permissionMode,
      autoModeEngine: runtimeDefaults.autoModeEngine,
      agentMode: runtimeDefaults.agentMode,
      // F045: 工作面（Coder / Partner）。缺省 'code'。host 落盘成 SDK session tag。
      surface: input.surface,
      ephemeral: input.ephemeral,
    });
    // v0.1.6 cleanup: 用 ~/.kodax/config.json 的 thinking 默认值初始化新 session。
    // 不传 schema 改动——renderer 没必要知道 thinking 默认值，main 直接 fill 即可。
    // model 不在这里 fill：跨 provider 切换时 KodaX config 里的 model 名通常对不上
    // 用户在 Space 选的 provider；要正确填要做 provider×model 映射，留 v0.1.7+。
    try {
      const kodaxDefaults = await loadKodaxUserDefaults();
      if (kodaxDefaults.thinking !== undefined) {
        kodaxHost.setThinking(sessionId, kodaxDefaults.thinking);
      }
    } catch (err) {
      console.warn(
        '[session.create] kodax defaults fill failed:',
        err instanceof Error ? err.message : err,
      );
    }
    if (input.ephemeral !== true && !(await kodaxHost.persistRuntime(sessionId))) {
      await kodaxHost.delete(sessionId);
      throw new Error('session runtime metadata could not be persisted');
    }
    return {
      sessionId,
      createdAt,
      reasoningMode: runtimeDefaults.reasoningMode,
      permissionMode: runtimeDefaults.permissionMode,
      autoModeEngine: runtimeDefaults.autoModeEngine,
      agentMode: runtimeDefaults.agentMode,
    };
  });

  registerChannel('session.promoteEphemeral', async (input) => {
    const promoted = await kodaxHost.promoteEphemeral(input.sessionId);
    return { promoted };
  });

  // session.send
  registerChannel('session.send', async (input) => {
    let session = kodaxHost.get(input.sessionId);
    if (!session) {
      // Lazy resume：sessionId 不在 in-flight，但磁盘上可能 persisted —— 重启 Space
      // 后从 Recents 点击的 session 走这条路。tryResume 内部走 createSession 接管
      // 原 sessionId，SDK 按 id 自动 resume lineage。
      const resumed = await kodaxHost.tryResume(input.sessionId);
      if (!resumed) {
        throw new Error(`session not found: ${input.sessionId}`);
      }
      session = kodaxHost.get(input.sessionId);
      if (!session) {
        throw new Error(`session resume failed: ${input.sessionId}`);
      }
    }
    // 第一次 send 时自动给 session 起个临时标题（基于 prompt 头部）。
    // ensureTitle 已经在 host 里做"title === undefined 才填"的判断，重复调用安全。
    assertSessionSendScope(session, {
      expectedProjectRoot: input.expectedProjectRoot,
      expectedSurface: input.expectedSurface,
    });
    if (input.partnerPromptOverlay !== undefined && session.surface !== 'partner') {
      throw new Error('partnerPromptOverlay is only accepted for Partner sessions');
    }
    kodaxHost.ensureTitle(input.sessionId, input.prompt);
    // send 是 fire-and-forget——立刻 ACK，事件流通过 push 推
    // send() returns { queued, queueId?, queueMode? }. If the turn is running,
    // Real adapter accepts the prompt into the requested queue mode so the UI
    // can show a queued acknowledgement instead of a HANDLER_ERROR.
    // OC-31 v0.1.9: input.artifacts (image paste / drag-drop) 透传给 session.send，
    // real-session 把它塞进 KodaXOptions.context.inputArtifacts → SDK 拼 multimodal content。
    //
    // review HIGH-2 fix: renderer 可能传任意 path 进 artifacts (eg /etc/passwd) 让 SDK
    // 把任意文件读进 multimodal content 发给 LLM。这里在调 session.send 前对每个 artifact
    // path 做沙箱校验——必须落在 <app temp>/kodax-space/clipboard/<sid>/ 之内，且 sid
    // 等于本次 send 的 sessionId (不许跨 session 引用图)。
    if (input.artifacts && input.artifacts.length > 0) {
      for (const a of input.artifacts) {
        await assertArtifactPathInClipboardSandbox(input.sessionId, a.path);
      }
    }
    await ensureProviderKeyInjected(session.provider);
    await validateInputArtifactsForSession(input.artifacts, session);
    const result = await session.send(input.prompt, input.artifacts, {
      queueMode: input.queueMode,
      ...(input.partnerPromptOverlay !== undefined
        ? { promptOverlay: input.partnerPromptOverlay }
        : {}),
    });
    return {
      accepted: true as const,
      ...(result.queued
        ? { queued: true, queueId: result.queueId, queueMode: result.queueMode }
        : {}),
    };
  });

  // session.cancel
  registerChannel('session.cancel', async (input) => {
    const cancelled = await kodaxHost.cancel(input.sessionId);
    return { cancelled };
  });

  // session.list
  // 可选 projectRoot 过滤——左抽屉切项目时只拉本项目下的 session。
  // 按 lastActivityAt 倒序，最近活动的在最前。
  //
  // 安全：
  //   - filter 同样过 validateProjectRoot——schema 只检字符串长度，
  //     不验证 abs path / no NUL / no ..
  //   - 用 path.normalize 后比较——避免 trailing slash / 大小写差异导致 filter miss
  //     （比如 session 存了 /Users/foo/proj，renderer 传 /Users/foo/proj/ 应该匹配）
  registerChannel('session.list', async (input) => {
    // reviewer MEDIUM-3: projectFilter 必须在传给 listMerged 前 normalize，
    // 让 SDK 层和 IPC 层比较同一形态（避免 Windows 路径 / 大小写 / trailing
    // slash 不一致让 persisted session 静默丢失）。
    // F005 v0.1.5：filter 必须是 allowlist 项目；保留 unfiltered（全部 session）路径。
    let projectFilter: string | undefined;
    if (input?.projectRoot !== undefined) {
      projectFilter = canonProjectRoot(await projectStore.assertAllowed(input.projectRoot));
    }
    // FEATURE_038: 合并视图 — in-flight (in-memory) ∪ SDK persisted
    // 传给 host.listMerged 的 projectRoot 是 canonical 形态（SDK listSessions 内部
    // 自己 normalize；当前 SDK 版本 projectRoot filter 不严格——本层再过一道 canon
    // 比较兜底）。
    // F045: surface 过滤透传给 host.listMerged（在合并 in-flight ∪ persisted 后统一 filter）。
    // 不传 = 全部（含历史无 tag 的，向后兼容）。Coder = surface!=='partner'，Partner = 'partner'。
    const merged = await kodaxHost.listMerged({
      projectRoot: projectFilter,
      surface: input?.surface,
    });

    // Persisted session 没有真运行时设置——磁盘上只 SDK lineage + gitRoot。先准备一份
    // user-defaults 兜底，给 sidebar UI 占位用（避免显示 "mock" 让用户以为整个 SDK 是 mock）。
    // loadKodaxUserDefaults 模块级缓存命中后零成本; providerConfigStore.load 自己缓存。
    // 并行 await 两个 promise——它们彼此无依赖，并行版省一个 turn 调度 ms。
    // tryResume 路径走相同 resolution，两边对齐，避免 UI 一闪即变。
    let persistedProviderFallback = 'mock';
    let persistedModelFallback: string | undefined;
    const [udResult, providerLoadResult] = await Promise.allSettled([
      loadKodaxUserDefaults(),
      providerConfigStore.load(),
    ]);
    if (udResult.status === 'fulfilled') {
      const ud = udResult.value;
      if (ud.provider) persistedProviderFallback = ud.provider;
      if (ud.model) persistedModelFallback = ud.model;
    }
    // Space defaultProviderId 优先级高于 KodaX user defaults——用户在 Space 设过默认 provider
    // 应该胜出；providerConfigStore.load 失败时保留 user-defaults / 'mock'。
    if (providerLoadResult.status === 'fulfilled') {
      const defaultId = providerConfigStore.getDefaultProviderId();
      if (defaultId) persistedProviderFallback = defaultId;
    }
    const kodaxCustomProviders = await loadKodaxCustomProviders().catch(() => []);
    // persisted session 没有 lastActivityAt——用 createdAt 占位（同一时间精度排序）
    const withTs = merged
      .filter((m) => {
        if (projectFilter === undefined) return true;
        if (m.kind === 'in-flight') {
          return canonProjectRoot(m.projectRoot) === projectFilter;
        }
        // persisted 的 projectRoot 来自 SDK runtimeInfo.workspaceRoot ?? gitRoot。
        // 当 SDK summary 缺这俩字段（fast path / 早期版本），projectRoot=undefined——
        // 此时无法本地 filter；保守地保留它，让用户看得到（宁可串项目，也比"以前的
        // session 全消失"体验好）。新版 SDK slow path 一旦填满 runtimeInfo 就走精确匹配。
        if (m.projectRoot === undefined) return true;
        return canonProjectRoot(m.projectRoot) === projectFilter;
      })
      .map((m) => {
        if (m.kind === 'in-flight') {
          return { item: m, sortKey: m.lastActivityAt };
        }
        // persisted: SDK 给 ISO date string；缺省 → 0（最旧）
        const ts = m.createdAt !== undefined ? Date.parse(m.createdAt) : 0;
        return { item: m, sortKey: Number.isFinite(ts) ? ts : 0 };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
    const sessions: SessionMeta[] = await Promise.all(
      withTs.map(async ({ item, sortKey }) => {
        if (item.kind === 'in-flight') {
          // in-flight 没有 msgCount 字段（ManagedSession 不跟用户消息计数），dashboard
          // 用 sessions[].msgCount ?? userMessagesBuffer.length 双源 fallback。
          // model 是用户 /model 设的值（undefined = provider 默认），透出去让 dashboard
          // 能按真 model 维度做 Favorite model 统计。
          return {
            sessionId: item.sessionId,
            projectRoot: item.projectRoot,
            provider: item.provider,
            reasoningMode: item.reasoningMode,
            permissionMode: item.permissionMode,
            autoModeEngine: item.autoModeEngine,
            agentMode: item.agentMode,
            surface: item.surface,
            title: item.title,
            createdAt: item.createdAt,
            lastActivityAt: item.lastActivityAt,
            parentSessionId: item.parentSessionId,
            forkPointTurnIdx: item.forkPointTurnIdx,
            model: item.model,
          };
        }
        // persisted: 运行时设置用 user-default 占位（Space defaultProviderId →
        // ~/.kodax/config.json → 'mock' 兜底）。tryResume 用同样链路 resolve，
        // 保证 sidebar 显示和真激活后的运行时设置一致——不会出现"点开 historical
        // session 看着是 mock，点了发消息后 BottomBar 突然跳到 deepseek-v4-pro"
        // 的视觉跳变。
        //
        // msgCount 直接透传 SDK summary 给的值——这是 dashboard 重启后 Messages 数
        // 正确的关键（无需扫 jsonl 内容，SDK 已经 fast-path 缓存了 summary）。
        const [runtimeDefaults, persistedRuntime] = await Promise.all([
          resolveRuntimeDefaults({
            sessionId: item.sessionId,
            includeSessionSidecar: true,
          }),
          getSessionRuntimeStore().read(item.sessionId),
        ]);
        const identity = resolveHistoricalRuntimeIdentity({
          ...(persistedRuntime !== null ? { persisted: persistedRuntime } : {}),
          fallbackProvider: persistedProviderFallback,
          ...(persistedModelFallback !== undefined
            ? { fallbackModel: persistedModelFallback }
            : {}),
          kodaxCustomProviders,
        });
        return {
          sessionId: item.sessionId,
          projectRoot: item.projectRoot ?? '/',
          provider: identity.provider,
          reasoningMode: runtimeDefaults.reasoningMode,
          permissionMode: runtimeDefaults.permissionMode,
          autoModeEngine: runtimeDefaults.autoModeEngine,
          agentMode: runtimeDefaults.agentMode,
          // F045: 真值——来自 SDK summary.tag 反推（host.listMerged 已派生），非占位。
          surface: item.surface,
          title: item.title,
          createdAt: sortKey,
          lastActivityAt: sortKey,
          msgCount: item.msgCount,
          model: identity.model,
          runtimeMetadataSource: identity.runtimeMetadataSource,
        };
      }),
    );
    return { sessions };
  });

  // session.delete
  registerChannel('session.delete', async (input) => {
    return deleteSessionForIpc(input.sessionId);
  });

  // session.setTitle
  registerChannel('session.setTitle', async (input) => {
    const ok = await kodaxHost.setTitle(input.sessionId, input.title);
    return { ok };
  });

  // session.setReasoningMode — F008
  registerChannel('session.setReasoningMode', async (input) => {
    const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
      kodaxHost.setReasoningMode(input.sessionId, input.mode),
    );
    return { ok };
  });

  // session.setProvider — F008
  // 必须先验 providerId 真实存在——schema 只验格式，不验 catalog（review C1-sec）
  registerChannel('session.setProvider', async (input) => {
    await assertProviderExists(input.providerId);
    await ensureCustomProviderRegistered(input.providerId);
    await ensureProviderKeyInjected(input.providerId);
    const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
      kodaxHost.setProvider(input.sessionId, input.providerId),
    );
    return { ok };
  });

  // session.setPermissionMode — FEATURE_029 canonical 3 mode
  // 切 mode 立即生效（下次 tool call broker.request 走新 mode 短路）。
  registerChannel('session.setPermissionMode', async (input) => {
    const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
      kodaxHost.setPermissionMode(input.sessionId, input.mode),
    );
    return { ok };
  });

  // session.setAutoModeEngine — FEATURE_029
  // 切 auto mode 子档 engine ('llm' | 'rules')。即便当前 mode 不是 'auto' 也接受
  // (用户先选 engine 再切 auto 是合法路径)，下次进入 auto 时按新 engine bootstrap guardrail。
  registerChannel('session.setAutoModeEngine', async (input) => {
    const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
      kodaxHost.setAutoModeEngine(input.sessionId, input.engine),
    );
    return { ok };
  });

  // session.setAgentMode — 切 KodaX agent 形态 (AMA / AMAW / SA)。
  // AMA = 多 agent 协作（KodaX 默认）；SA = 单 agent 降级路径，接口并发受限时使用。
  // 切换不重启 in-flight session，下一条 prompt 走新形态。
  registerChannel('session.setAgentMode', async (input) => {
    const ok = await commitRuntimeMutationForIpc(input.sessionId, () =>
      kodaxHost.setAgentMode(input.sessionId, input.agentMode),
    );
    return { ok };
  });

  // session.fork — FEATURE_038 (持久化)
  // v0.1.6: SDK forkSession 写盘出新 sessionId；host 用 source 运行时设置实例化
  // 新 ManagedSession 入 in-memory map。events 复制仍由 renderer 完成（重启后从
  // SDK loadSession 重放是 v0.1.7+ 优化）。
  registerChannel('session.fork', async (input) => {
    const result = await kodaxHost.fork(input.sessionId, input.forkPointTurnIdx);
    if (!result) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    return result;
  });

  // session.rewind — FEATURE_038 (持久化)
  // v0.1.6: main 端 cancel in-flight (await)，然后 SDK rewindSession 写盘截断；
  // renderer 截断 events 数组。
  registerChannel('session.rewind', async (input) => {
    return kodaxHost.rewind(input.sessionId, input.rewindPastTurnIdx);
  });

  // session.agentsMd — FEATURE_034
  // 拉取 session.projectRoot 下当前的 AGENTS.md 列表 (global + project)。
  // 每次都重 load（disk stat + read）—— 不缓存，让 AGENTS.md 修改后下次 popout 打开即生效。
  // 安全：projectRoot 在 session.create 已经 validateProjectRoot 过，这里复用 session 持有的值，
  // 不让 renderer 直接传任意路径。
  // **async**：v0.1.6 后 loadAgentsMd 走 SDK loadAgentsFiles (同步 I/O)，保留 async
  // 包装兼容 handler 签名；SDK 抛任何异常都被 loader try/catch 转空数组 (reviewer HIGH-2)。
  registerChannel('session.agentsMd', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const files = await loadAgentsMd({ projectRoot: session.projectRoot });
    return { files };
  });

  // session.agentsMd.save — REPL /memory inline edit 等价
  //
  // 安全设计:
  //   - scope 闭集 ['global', 'project'] -- renderer 不能传任意 path
  //   - target path 在 main 端计算 (~/.kodax/AGENTS.md / <session.projectRoot>/AGENTS.md),
  //     从 host.get(sessionId).projectRoot 拿,renderer 永远拿不到任意路径写权
  //   - 原子写: tmp 文件 → fs.rename,避免半写状态被 SDK loadAgentsFiles 读到
  //   - 文件权限 0o600 (与 ~/.kodax/auto-rules.jsonc 等 sensitive config 一致)
  //   - content 256KB schema 上限已经在 envelope 校验
  registerChannel('session.agentsMd.save', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const crypto = await import('node:crypto');

    let targetPath: string;
    if (input.scope === 'global') {
      // OC-12 测试模式下走 tmpdir/kodax-test-<id>
      const globalDir = getKodaxDir();
      await fs.mkdir(globalDir, { mode: 0o700, recursive: true }).catch(() => {
        /* mkdir 失败 (磁盘满 / 权限) 走下面写入时再失败,统一错误处理 */
      });
      targetPath = path.join(globalDir, 'AGENTS.md');
    } else {
      // 'project'
      targetPath = path.join(session.projectRoot, 'AGENTS.md');
    }

    // 原子写: 同目录 tmp 文件 → rename。tmp 名带随机后缀防并发覆盖。
    const tmpSuffix = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${targetPath}.tmp-${tmpSuffix}`;
    try {
      await fs.writeFile(tmpPath, input.content, { mode: 0o600 });
      await fs.rename(tmpPath, targetPath);
    } catch (err) {
      // 清理 tmp (best-effort, 不影响 error 抛出)
      await fs.unlink(tmpPath).catch(() => {});
      throw new Error(
        `failed to write AGENTS.md: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { ok: true, path: targetPath };
  });

  // session.listRunning — FEATURE_125 Team Mode peer 列表
  //
  // 调 SDK listRunningSessions(): 全系统活的 KodaX peer 实例 (含别的 Space 窗口 / CLI),
  // 排除自己。Renderer 用来:
  //   - /status slash command 输出
  //   - LeftSidebar 顶部 badge "N other peers" (让用户知道多窗口在跑)
  // SDK 走 file-based discovery (~/.kodax/instances 目录),NEVER throws,no instances dir →
  // [],不阻塞 UI。
  registerChannel('session.listRunning', async () => {
    const sdkSession = await loadSdkSessionCached();
    const list = await sdkSession.listRunningSessions();
    // SDK 返回包括自己 — 用 pid 过滤掉自己; 其他 peer 也限到 64 防 schema 上限
    const myPid = process.pid;
    const peers = list
      .filter((p) => p.pid !== myPid)
      .slice(0, 64)
      .map((p) => ({
        pid: p.pid,
        startedAt: p.startedAt,
        cwd: p.cwd,
        ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
      }));
    return { peers };
  });

  // session.history — 历史 session 切换时恢复对话内容（events / userMessages buffer in-memory，
  // 重启后空；renderer 调本 channel 拉 KodaX SDK 持久化的 messages 数组，flatten 成
  // user / assistant_text / tool_call 序列,回填 store）。
  //
  // **v0.1.x 全量回放**: tool_use / tool_result block 不再丢弃 —— 按原 message 顺序拍平
  // 成 'tool_call' item (toolId / toolName / input / result)。assistant 一轮内文本和工具
  // 调用交替时,items 数组顺序就是回放顺序,renderer composeMessages 自动重建气泡 + tool card。
  //
  // 工具结果匹配: tool_result block 在后续 user message 里,通过 toolId 与之前的 tool_use 配对。
  // 失配 (tool_use 没等到 tool_result, 或 tool_result 没找到对应 tool_use) 仍 emit
  // tool_call item,result 字段缺失 → renderer 会渲染为 "running" 状态卡片。
  registerChannel('session.localNotice.append', async (input) => {
    const payload: Record<string, string> = { id: input.notice.id };
    if (input.notice.variant !== undefined) payload.variant = input.notice.variant;
    const entry = await appendPersistedClientNotice(input.sessionId, {
      source: 'space-local-notice',
      content: input.notice.content,
      timestamp: isoTimestampFromSentAt(input.notice.sentAt),
      payload,
    });
    if (entry === null) {
      await getSessionLocalNoticeStore().append(input.sessionId, input.notice);
    }
    return { ok: true };
  });

  registerChannel('session.localNotice.replace', async (input) => {
    await getSessionLocalNoticeStore().replace(input.sessionId, input.notices);
    return { ok: true };
  });

  registerChannel('session.history', async (input) => {
    const withLocalNotices = async (
      baseItems: readonly SessionHistoryItem[],
    ): Promise<{ items: SessionHistoryItem[] }> => {
      const localNotices = await getSessionLocalNoticeStore().list(input.sessionId);
      return { items: appendLocalNoticeHistoryItems(baseItems, localNotices) };
    };
    // Full append-order transcript (not just the active branch) so pre-compaction
    // turns stay visible in scrollback — fixes "history disappears after compaction".
    const data = await loadPersistedTranscript(input.sessionId);
    if (!data || !Array.isArray(data.messages)) {
      return withLocalNotices([]);
    }
    const items: SessionHistoryItem[] = [];

    // 第一步: 走一遍消息收集 toolId → result 映射 (tool_result 永远在 tool_use 之后,
    // 但同一 message 里也可能有多个 tool_use,先扫一遍简化处理)
    const toolResults = new Map<string, { content: string; isError: boolean }>();
    for (const msg of data.messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        if ((block as { type?: unknown }).type !== 'tool_result') continue;
        const id = (block as { tool_use_id?: unknown }).tool_use_id;
        if (typeof id !== 'string') continue;
        const content = flattenToolResultContent((block as { content?: unknown }).content);
        const isError = Boolean((block as { is_error?: unknown }).is_error);
        toolResults.set(id, { content, isError });
      }
    }

    // 第二步: 按顺序拍平 messages 成 items
    //
    // v0.1.x 修复 "fork/rewind branch_summary 回放成假用户气泡": fork 回到某个分支点时,
    // SDK 会在 lineage 里合成一条 role==='user' 的 context message,把"你之前探索过的另一条
    // 分支"的摘要塞给 LLM 当上下文——但这段文字从来不是用户真的打的字。旧逻辑直接按
    // msg.role 拍平,于是这段摘要在滚动区里显示成一条用户消息(压缩产生的 compaction 摘要
    // 同理,role==='system')。
    //
    // loadFullTranscript (SDK 0.7.51+) 额外提供 transcriptEntries——每条 message 对应一个
    // entry,entry.type 精确标出 'message' / 'compaction' / 'branch_summary',不需要靠猜 role。
    // 有了它就按 entry.type 路由:branch_summary/compaction → 非 user 的 lineage_notice 历史
    // 提示条(entry.summary 是没被模板包裹的干净文本,优先用它);其余(type==='message')走
    // 原有逻辑不变。旧 SDK / 测试 mock 没有 transcriptEntries 时,整段回退成"每条 message
    // 都当作 type:'message'"——即完全不变的旧行为。
    const rawTranscriptEntries = (data as { transcriptEntries?: unknown }).transcriptEntries;
    type TranscriptEntryLike = {
      readonly entryId?: unknown;
      readonly logicalId?: unknown;
      readonly sourceEntryId?: unknown;
      readonly type?: unknown;
      readonly source?: unknown;
      readonly message: (typeof data.messages)[number];
      readonly summary?: unknown;
      readonly payload?: unknown;
      readonly taskResults?: unknown;
      readonly turnId?: unknown;
      readonly content?: unknown;
      // SDK 0.7.51+ SessionTranscriptEntry.timestamp (ISO string) — the real per-message
      // wall-clock. We forward it as the history item's sentAt so restored turns keep their
      // true time instead of all collapsing onto session.createdAt (the renderer fallback).
      // Without it, workflow notices — which DO carry real run times — sort above the whole
      // restored conversation after a compaction re-root (createdAt is reset later than the run).
      readonly timestamp?: unknown;
      // SDK marks each transcript entry active (on the live branch) or not. Used to scope
      // dedup to inactive old-island re-clones only — the active branch is never collapsed.
      readonly active?: unknown;
    };
    const entries: readonly TranscriptEntryLike[] = Array.isArray(rawTranscriptEntries)
      ? (rawTranscriptEntries as TranscriptEntryLike[])
      : data.messages.map((message) => ({ type: 'message', message }));

    // Workflow 结果原位还原用:一条 `<task-completed>` 块只有当它的 task_id 命名了一个 Space 落盘的
    // workflow run(<space>/workflow-runs/<runId>/)才算 workflow —— 借此把用同样 wrapper 的普通
    // dispatch_child_task 排除掉(review HIGH)。
    const workflowRunBaseDir = path.join(getSpaceDataDir(), 'workflow-runs');
    // 同一个 workflow run 的结果只渲染一次:被压缩/re-root 过的 session,loadFullTranscript 的全谱系里
    // 同一条 `<task-completed>` 会重复出现(旧的侧存储按 finished:runId:status 去重、只显一份;approach A
    // 改按 transcript 位置渲染后丢了去重 → 同一份报告显示多次)。按 runId 去重、保留**首次**出现的位置。
    const seenWorkflowRunIds = new Set<string>();
    // 整段对话重复渲染修复:loadFullTranscript 返回全谱系。① 新 session:旧岛消息被 evict 成
    // "[compacted]" 占位 → 跳过;② 旧 session(更早 SDK 写的):旧岛保留真内容、每次压缩逐字节克隆一份
    // → 按内容折叠。去重**限定在 inactive 旧岛**,活动分支一条不碰(不折叠合法重复的活动消息)。
    // 见 transcript-dedup.ts 的机制说明。
    const dedupedEntries = dedupeTranscriptEntries(entries);

    for (const entry of dedupedEntries) {
      const entrySentAt = parseEntrySentAt(entry.timestamp);
      if (entry.type === 'client_notice') {
        const notice = clientNoticeHistoryItemFromEntry(entry, entrySentAt);
        if (notice !== null) {
          items.push(notice);
        }
        if (items.length >= 2000) break;
        continue;
      }
      if (entry.type === 'branch_summary' || entry.type === 'compaction') {
        const rawSummary =
          typeof entry.summary === 'string' && entry.summary.trim().length > 0
            ? entry.summary
            : extractUserText((entry.message as { content?: unknown }).content);
        const text = rawSummary.trim();
        if (text.length > 0) {
          items.push({ kind: 'lineage_notice', noticeKind: entry.type, text });
        }
        if (items.length >= 2000) break;
        continue;
      }
      const taskResults = extractTaskResults(entry);
      if (entry.type === 'task_result' || taskResults.length > 0) {
        appendWorkflowTaskResultNotices(taskResults, seenWorkflowRunIds, items);
        if (items.length >= 2000) break;
        // Consume the entry only if a real workflow run was recognized. Legacy transcripts
        // (recorded before structured task-result metadata) have the SDK reconstruct
        // `_taskResults` stamped source:'child_task' even for real run_workflow results, so
        // the block above renders nothing. Fall through to the `<task-completed>` text parse
        // below — which cross-checks isWorkflowRunDir() against disk instead of trusting
        // `source` — so those notices still restore (App.tsx's old run-dir side-store restore
        // that used to cover this was removed this release). Guard on a parseable message so a
        // messageless task_result entry still short-circuits instead of hitting `msg.role`.
        if (taskResults.some((r) => r.source === 'workflow') || !isRecord(entry.message)) continue;
      }
      const msg = entry.message;
      const meta = msg as {
        _source?: unknown;
        source?: unknown;
        _synthetic?: unknown;
        synthetic?: unknown;
      };
      const source = meta.source ?? meta._source;
      const synthetic = meta.synthetic === true || meta._synthetic === true;
      if (msg.role === 'user' && source === 'sidecar-verifier') {
        const sidecarText = extractUserText(msg.content);
        if (sidecarText.length > 0) {
          items.push({
            kind: 'sidecar_message',
            message: {
              source: 'sidecar-verifier',
              verdict: 'revise',
              recipient: 'main-agent',
              delivery: 'synthetic-user-message',
              content: sidecarText,
              // #12 fix: SDK 不持久化真实 verdict/delivery/suggestedFix——上面几个字段都是
              // 占位值,不是这条消息当时真实的判定结果。标 historical=true 让 renderer 用中性
              // 的"历史记录"标签展示,不再断言 verdict==='revise'。
              historical: true,
            },
          });
        }
        continue;
      }
      // Workflow 结果/失败:SDK 把 run 的最终结果作为一条 _synthetic 的 `<task-completed …>`
      // user 消息存进 transcript(位置正确)。识别它、原位渲染成 workflow 历史提示条——否则会被
      // 下面的 `if (synthetic) continue` 丢掉,只能靠侧存储按 wall-clock 重排(SDK 压缩把时间戳
      // 压平后 → resume 乱序/置顶)。见 historyWorkflowNoticeSchema。
      if (synthetic && msg.role === 'user') {
        // 一条合成消息可能批了多个 `<task-completed>` 块;逐块解析、只对**真 workflow run** 出 notice
        // (dispatch_child_task 用同样的 wrapper、但没落盘目录 → isWorkflowRunDir 排除,避免误标)。
        const blocks = parseTaskCompletedBlocks(extractUserText(msg.content));
        if (blocks.length > 0) {
          const { render, handled } = selectWorkflowBlocks(
            blocks,
            seenWorkflowRunIds,
            workflowRunBaseDir,
          );
          for (const b of render) {
            items.push({ kind: 'workflow_notice', text: b.text });
            if (items.length >= 2000) break;
          }
          if (handled) continue; // 已处理(渲染或去重跳过)workflow 结果
          // 否则(全是普通子任务 / 未落盘的 run)→ 落到下面的 synthetic-skip,和以前一样隐藏。
        }
      }
      if (synthetic) continue; // 其余 SDK 合成消息隐藏
      if (msg.role === 'system') continue; // system prompts 内部

      if (msg.role === 'user') {
        // user message 通常 = pure text;若是工具结果回灌 (content 是 tool_result block 数组),
        // 则 text === '',不 emit user item (但 tool_results map 已经在第一步抽走了)
        const userText = extractUserText(msg.content);
        if (userText.length > 0) {
          items.push({
            kind: 'user',
            content: userText,
            // Real per-message time (see TranscriptEntryLike.timestamp). Only the user item
            // needs it: it becomes a UserMessage whose sentAt drives composeMessages' merge
            // with workflow notices; assistant/tool items become events that inherit the turn.
            ...(entrySentAt !== undefined ? { sentAt: entrySentAt } : {}),
          });
        }
      } else if (msg.role === 'assistant') {
        // assistant: 按 content blocks 顺序逐个发 — text/thinking 累积到下次 tool_use 边界
        // flush 出 'assistant' item;tool_use 直接 emit 'tool_call' item
        let textBuf = '';
        let thinkingBuf = '';
        const flushText = (): void => {
          if (textBuf.length > 0 || thinkingBuf.length > 0) {
            const it: SessionHistoryItem =
              thinkingBuf.length > 0
                ? { kind: 'assistant', text: textBuf, thinking: thinkingBuf }
                : { kind: 'assistant', text: textBuf };
            items.push(it);
            textBuf = '';
            thinkingBuf = '';
          }
        };
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : typeof msg.content === 'string'
            ? [{ type: 'text', text: msg.content }]
            : [];
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue;
          const t = (block as { type?: unknown }).type;
          if (t === 'text') {
            const s = (block as { text?: unknown }).text;
            if (typeof s === 'string') textBuf += s;
          } else if (t === 'thinking') {
            const s = (block as { thinking?: unknown }).thinking;
            if (typeof s === 'string') thinkingBuf += s;
          } else if (t === 'tool_use') {
            // 工具调用 → 先 flush 累积的 text/thinking,然后 emit tool_call item
            flushText();
            const id = (block as { id?: unknown }).id;
            const name = (block as { name?: unknown }).name;
            const rawInput = (block as { input?: unknown }).input;
            if (typeof id === 'string' && typeof name === 'string') {
              const matched = toolResults.get(id);
              const tcItem: SessionHistoryItem = {
                kind: 'tool_call',
                toolId: id,
                toolName: name,
                ...(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                  ? { input: rawInput as Record<string, unknown> }
                  : {}),
                ...(matched !== undefined
                  ? { result: matched.content, ...(matched.isError ? { isError: true } : {}) }
                  : {}),
              };
              items.push(tcItem);
            }
          }
          if (items.length >= 2000) break;
        }
        flushText();
      }
      if (items.length >= 2000) break;
    }
    return withLocalNotices(items);
  });
}

/** SessionTranscriptEntry.timestamp → epoch ms. SDK gives an ISO string; tolerate a raw
 *  number too. Returns undefined for missing/invalid so the renderer keeps its createdAt
 *  fallback rather than stamping NaN. */
const MAX_HISTORY_TEXT = 262_144;

function isoTimestampFromSentAt(sentAt: number): string {
  const date = new Date(sentAt);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampHistoryText(text: string): string {
  if (text.length <= MAX_HISTORY_TEXT) return text;
  const marker = '\n[truncated]';
  return `${text.slice(0, Math.max(0, MAX_HISTORY_TEXT - marker.length)).trimEnd()}${marker}`;
}

function clientNoticeHistoryItemFromEntry(
  entry: {
    readonly entryId?: unknown;
    readonly logicalId?: unknown;
    readonly sourceEntryId?: unknown;
    readonly timestamp?: unknown;
    readonly content?: unknown;
    readonly payload?: unknown;
    readonly message?: { readonly content?: unknown; readonly timestamp?: unknown } | null;
  },
  entrySentAt: number | undefined,
): SessionHistoryItem | null {
  const directPayload = isRecord(entry.payload) ? entry.payload : undefined;
  const nestedPayload =
    directPayload && isRecord(directPayload.payload) ? directPayload.payload : undefined;
  const content =
    stringField(entry.content) ??
    stringField(directPayload?.content) ??
    stringField(nestedPayload?.content) ??
    extractUserText(entry.message?.content);
  if (content.length === 0) return null;
  const sentAt = entrySentAt ?? parseEntrySentAt(entry.message?.timestamp) ?? 0;
  const variantValue = stringField(nestedPayload?.variant) ?? stringField(directPayload?.variant);
  const variant =
    variantValue === 'echo' || variantValue === 'output'
      ? variantValue
      : content.trimStart().startsWith('/')
        ? 'echo'
        : 'output';
  const id =
    stringField(nestedPayload?.id) ??
    stringField(directPayload?.id) ??
    stringField(entry.entryId) ??
    stringField(entry.logicalId) ??
    stringField(entry.sourceEntryId) ??
    `client_notice_${sentAt}`;
  return {
    kind: 'local_notice',
    id: id.slice(0, 128),
    content: clampHistoryText(content),
    sentAt,
    variant,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

interface TaskResultMetadataLike {
  readonly type: 'task_result';
  readonly source: 'workflow' | 'child_task';
  readonly taskId: string;
  readonly runId?: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly title?: string;
  readonly summary?: string;
}

function isTaskResultMetadataLike(value: unknown): value is TaskResultMetadataLike {
  if (!isRecord(value)) return false;
  return (
    value.type === 'task_result' &&
    (value.source === 'workflow' || value.source === 'child_task') &&
    typeof value.taskId === 'string' &&
    (value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled') &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.summary === undefined || typeof value.summary === 'string')
  );
}

function extractTaskResults(entry: {
  readonly taskResults?: unknown;
  readonly payload?: unknown;
  readonly message?: unknown;
}): TaskResultMetadataLike[] {
  const out: TaskResultMetadataLike[] = [];
  collectTaskResults(entry.taskResults, out);
  collectTaskResults(entry.payload, out);
  if (isRecord(entry.message)) {
    collectTaskResults(entry.message._taskResult, out);
    collectTaskResults(entry.message._taskResults, out);
  }
  return out;
}

function collectTaskResults(value: unknown, out: TaskResultMetadataLike[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTaskResults(item, out);
    return;
  }
  if (isRecord(value) && Array.isArray(value.results)) {
    collectTaskResults(value.results, out);
    return;
  }
  if (isTaskResultMetadataLike(value)) {
    out.push(value);
  }
}

function appendWorkflowTaskResultNotices(
  taskResults: readonly TaskResultMetadataLike[],
  seenWorkflowRunIds: Set<string>,
  items: SessionHistoryItem[],
): void {
  for (const result of taskResults) {
    if (result.source !== 'workflow') continue;
    const key = result.runId ?? result.taskId;
    if (seenWorkflowRunIds.has(key)) continue;
    seenWorkflowRunIds.add(key);
    items.push({ kind: 'workflow_notice', text: formatWorkflowTaskResultNotice(result) });
    if (items.length >= 2000) break;
  }
}

function formatWorkflowTaskResultNotice(result: TaskResultMetadataLike): string {
  const id = result.runId ?? result.taskId;
  const title = result.title?.trim();
  const header = `[workflow] ${result.status}${title ? ` · ${title}` : ''}${id ? ` · ${id}` : ''}`;
  const summary = result.summary?.trim();
  return clampHistoryText(summary ? `${header}\n${summary}` : header);
}

function parseEntrySentAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/** user message content 提取纯文本部分;若 content 是 string 直接返回;若是 blocks 数组取 type=='text'.
 *  tool_result blocks 不在这里出 — 它们在 history handler 第一步单独收集映射到 toolId。 */
function toLocalNoticeHistoryItem(notice: SessionLocalNotice): SessionHistoryItem {
  return {
    kind: 'local_notice',
    id: notice.id,
    content: notice.content,
    sentAt: notice.sentAt,
    ...(notice.variant !== undefined ? { variant: notice.variant } : {}),
  };
}

function appendLocalNoticeHistoryItems(
  baseItems: readonly SessionHistoryItem[],
  localNotices: readonly SessionLocalNotice[],
): SessionHistoryItem[] {
  const existingLocalIds = new Set(
    baseItems.flatMap((item) => (item.kind === 'local_notice' ? [item.id] : [])),
  );
  const localItems = localNotices
    .filter((notice) => !existingLocalIds.has(notice.id))
    .map(toLocalNoticeHistoryItem)
    .slice(-2000);
  if (localItems.length === 0) return baseItems.slice(0, 2000);
  const baseLimit = Math.max(0, 2000 - localItems.length);
  return [...baseItems.slice(0, baseLimit), ...localItems];
}

function extractUserText(content: unknown): string {
  if (typeof content === 'string')
    return content.length > 256 * 1024 ? content.slice(0, 256 * 1024) + '\n…(truncated)' : content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const t = (block as { type?: unknown }).type;
    if (t === 'text') {
      const s = (block as { text?: unknown }).text;
      if (typeof s === 'string') text += s;
    }
    // tool_result / image / 其他 — 跳过
  }
  if (text.length > 256 * 1024) text = text.slice(0, 256 * 1024) + '\n…(truncated)';
  return text;
}

/** tool_result.content 拍平: 可能是 string,可能是 content blocks 数组 (含 text/image)。
 *  只保留 text;过长截断兜底防 schema 上限报错。 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.length > 512 * 1024 ? content.slice(0, 512 * 1024) + '\n…(truncated)' : content;
  }
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if ((block as { type?: unknown }).type === 'text') {
      const s = (block as { text?: unknown }).text;
      if (typeof s === 'string') text += s;
    }
    // image blocks 等丢弃
  }
  if (text.length > 512 * 1024) text = text.slice(0, 512 * 1024) + '\n…(truncated)';
  return text;
}

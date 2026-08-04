// Space-side AutoModeToolGuardrail bootstrap — FEATURE_030.
//
// 镜像 KodaX REPL 的 packages/repl/src/interactive/auto-mode-bootstrap.ts，但因
// @kodax-ai/kodax 0.7.40 dist 没单独 export `bootstrapAutoMode`，Space 自己用
// 已暴露的 lower-level API 拼装：
//
//   createAutoModeToolGuardrail({...})  ← guardrail 工厂
//   loadAutoRules({...})                ← 读 ~/.kodax/auto-rules.jsonc + 项目级
//   formatAgentsForPrompt(files)        ← AGENTS.md 数组 → prompt 文本块
//   getRegisteredToolDefinition(name)   ← Tool registry 投影 (Tier1 classifier 用)
//   resolveProvider(name)               ← Provider 实例化（classifier sideQuery 用）
//
// 入口：bootstrapAutoMode(opts) → 返回 { getGuardrail, rulesLoadResult }
// FEATURE_030 wire: real-session.ts 在 mode='auto' 时 await 一次，把 getGuardrail()
// 结果 push 进 KodaXOptions.guardrails 数组。

import path from 'node:path';
// **静态 import 改 dynamic** — SDK subpath exports 仅 "import" 条件，CJS-built main require 撞 ERR_PACKAGE_PATH_NOT_EXPORTED；
// dynamic import 命中 "import" 条件正常工作。type-only 用 `import type` 不产生 runtime require。
import type {
  AgentsFile,
  AutoModeAskUser,
  AutoModeEngine,
  AutoModeToolGuardrail,
  KodaXBaseProvider,
  RulesLoadResult,
} from '@kodax-ai/kodax/coding';
import { loadAgentsMd } from './agents-md-loader.js';

type SdkCodingModule = typeof import('@kodax-ai/kodax/coding');
let sdkCodingCache: SdkCodingModule | null = null;
async function loadSdkCoding(): Promise<SdkCodingModule> {
  if (sdkCodingCache === null) {
    sdkCodingCache = await import('@kodax-ai/kodax/coding');
  }
  return sdkCodingCache;
}

export interface SpaceAutoModeBootstrapDeps {
  readonly askUser: AutoModeAskUser;
  readonly projectRoot: string;
  /** 当前会话 provider 名 — 由 RealKodaXSession 闭包 live-read，防止 mid-run /provider 切换失效。*/
  readonly getCurrentProviderName: () => string;
  /** 当前会话 model；返回空字符串会 warn 但仍传递（保留 SDK 配置上下文）。*/
  readonly getCurrentModel: () => string;
  /** 当前 auto engine sub-mode (用户首选 / 自动 fallback 后)。*/
  readonly initialEngine: AutoModeEngine;
  /** sideQuery classifier 超时 (ms)。未配置时由 SDK 决定（0.7.80 起：首次 45s / 重试 90s）。*/
  readonly timeoutMs?: number;
  /** engine 变更回调；FEATURE_030 wire 到 emit auto_engine_change SessionEvent. */
  readonly onEngineChange?: (engine: AutoModeEngine) => void;
  /** 结构化日志；Space 端把 'warn' 路由到 console.warn。*/
  readonly log?: (level: 'info' | 'warn', msg: string) => void;
}

export interface SpaceAutoModeBootstrapResult {
  /**
   * Lazy accessor — 首次调用时构造 guardrail，后续返回同一实例。
   * 这样多次 send / iteration 共享 denial tracker + circuit breaker 状态，
   * 与 KodaX REPL 行为一致。
   */
  readonly getGuardrail: () => AutoModeToolGuardrail;
  /** loadAutoRules 输出；sources / errors / skipped 给 renderer 显示 banner 用。*/
  readonly rulesLoadResult: RulesLoadResult;
}

/**
 * Async — `loadAutoRules` 读盘。RealKodaXSession 在 mode='auto' 路径上 await 一次；
 * 非 auto session 不进这里，零 IO 成本。
 *
 * 设计权衡：AGENTS.md 在 bootstrap 内 snapshot（不是 live getter），与 KodaX REPL 一致。
 * mid-run AGENTS.md 文件被编辑后，要重启 session（或重新 bootstrap）才生效——这是
 * 罕见路径，且 KodaX classifier 也是 snapshot；保持一致。
 */
export async function bootstrapAutoMode(
  deps: SpaceAutoModeBootstrapDeps,
): Promise<SpaceAutoModeBootstrapResult> {
  const projectRoot = path.isAbsolute(deps.projectRoot)
    ? deps.projectRoot
    : path.resolve(deps.projectRoot);

  const sdk = await loadSdkCoding();
  const rulesLoadResult = await sdk.loadAutoRules({
    userKodaxDir: sdk.getKodaxGlobalDir(),
    projectRoot,
  });

  // AGENTS.md snapshot（Space 自己的 loader；F034）
  const agentsFiles: AgentsFile[] = await loadAgentsMd({ projectRoot });
  const claudeMd = sdk.formatAgentsForPrompt(agentsFiles);

  let guardrail: AutoModeToolGuardrail | undefined;

  const getGuardrail = (): AutoModeToolGuardrail => {
    if (guardrail) return guardrail;

    const initialProvider = deps.getCurrentProviderName();
    const initialModel = deps.getCurrentModel();

    guardrail = sdk.createAutoModeToolGuardrail({
      rules: rulesLoadResult.merged,
      claudeMd,
      askUser: deps.askUser,
      getToolProjection: (toolName) => {
        const def =
          sdk.getRegisteredToolDefinition(toolName) ??
          sdk.getBuiltinRegisteredToolDefinition(toolName);
        return def?.toClassifierInput;
      },
      resolveProvider: (name): KodaXBaseProvider | undefined => {
        try {
          return sdk.resolveProvider(name);
        } catch {
          return undefined;
        }
      },
      defaultProvider: initialProvider,
      defaultModel: initialModel,
      // Live getters — mid-run /model /provider 切换可以让 classifier 跟随新 provider/model
      getDefaultProvider: deps.getCurrentProviderName,
      getDefaultModel: () => {
        const m = deps.getCurrentModel();
        if (!m) {
          deps.log?.(
            'warn',
            '[auto-mode] classifier defaultModel is empty; main session has no model set — classifier will likely fail',
          );
          return '';
        }
        return m;
      },
      log: deps.log,
      onEngineChange: deps.onEngineChange,
      projectRoot,
      initialEngine: deps.initialEngine,
      // 仅在显式配置时转发——否则让 SDK 0.7.80 使用两次尝试默认 (45s / 90s)。
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });

    return guardrail;
  };

  return { getGuardrail, rulesLoadResult };
}

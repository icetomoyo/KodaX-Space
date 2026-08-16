// Model context-window resolution — pure helper (extracted from provider.ts)
//
// 单一事实源：显示给用户的上下文窗口必须等于 KodaX runtime 真正决定 compaction 触发的窗口。
// runtime 用的级联（见 SDK compaction 源码）是：
//   CompactionConfig.contextWindow ?? provider.getEffectiveContextWindow(model)
//     ?? provider.getContextWindow() ?? 200_000
// 这正是 SDK `resolveContextWindow(config, provider, model)` 的实现。
//
// ⚠️ 历史坑（"反复出问题"）：不要用 `resolveModelCapabilities(providerId, model).contextWindow`。
// SDK 0.7.58 有 bug——当请求的 model 恰好等于 provider 的默认 model 时（zhipu-coding /
// 即使显式选择 zai-coding/glm-5.2，resolveModelCapabilities 也必须返回模型级能力，而不是
// model 级 override (1M)，导致 GLM-5.2 显示 200k。getEffectiveContextWindow(model) 走 model 级，
// 不受该 bug 影响，且与 runtime compaction 窗口一致。见 context-window.test.ts 回归守卫。

/** SDK provider 对象——只关心这两个可选方法用于区分 fallback。*/
export interface ProviderContextWindowShape {
  getEffectiveContextWindow?: unknown;
  getContextWindow?: unknown;
}

/**
 * SDK `resolveContextWindow` 的最小签名（注入 seam）。第二参在 SDK 里是 KodaXBaseProvider；
 * 本 helper 刻意不引 SDK 类型（解耦 + 避开 ESM-only type 麻烦），用 any 承接该 seam。
 */
export type ResolveContextWindowFn = (
  config: {
    enabled: boolean;
    triggerPercent: number;
    triggerTokens?: number;
    contextWindow?: number;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any,
  model: string,
) => number;

export type ContextWindowSource = 'provider' | 'fallback';

export interface EffectiveCompactionWindowConfig {
  readonly enabled: boolean;
  readonly triggerPercent: number;
  readonly triggerTokens?: number;
  readonly contextWindow?: number;
}

export interface ModelContextWindow {
  readonly contextWindow: number;
  readonly source: ContextWindowSource;
}

/** SDK 的 hard fallback 上下文窗口——provider 完全没 advertise 时的兜底值。*/
export const SDK_HARD_FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * 用 SDK 的 runtime-authoritative 级联算 (contextWindow, source)。
 *
 * @param provider  SDK `resolveProvider(providerId)` 的返回对象
 * @param model     具体 model id
 * @param resolveContextWindow  SDK `@kodax-ai/kodax/agent` 的同名导出
 */
export function computeModelContextWindow(
  provider: ProviderContextWindowShape,
  model: string,
  resolveContextWindow: ResolveContextWindowFn,
  compaction: EffectiveCompactionWindowConfig = { enabled: true, triggerPercent: 75 },
): ModelContextWindow {
  const contextWindow = resolveContextWindow(compaction, provider, model);
  // source: cw 是 provider-advertised 还是 200k hard fallback？
  //   200k 且 provider 既无 getEffectiveContextWindow 也无 getContextWindow → 纯兜底，标 'fallback'
  //   （renderer 收到 'fallback' 会改用自己的 hardcoded 表，对 custom_* / 未配 key 的 provider 更准）；
  //   其余（含 provider 真实 advertised 的 200k，如 claude 系列）一律 'provider'。
  let source: ContextWindowSource = 'provider';
  if (
    contextWindow === SDK_HARD_FALLBACK_CONTEXT_WINDOW &&
    typeof provider.getEffectiveContextWindow !== 'function' &&
    typeof provider.getContextWindow !== 'function'
  ) {
    source = 'fallback';
  }
  return { contextWindow, source };
}

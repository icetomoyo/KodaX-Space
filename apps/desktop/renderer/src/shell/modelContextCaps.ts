// Per-model context window caps — fallback only (alpha.2)
//
// 主入口已切到 SDK driven 的 IPC `provider.modelContextWindow`（走 resolveContextWindow 的
// 四步级联），与 SDK runtime 决定 compaction 触发的算法完全同源。本表只在以下情况兜底：
//   - 初次 mount IPC 未返回前（UI 同步首帧避免空窗）
//   - 渲染进程拿不到 window.kodaxSpace（preload 异常）
//   - IPC 失败 / SDK 不识别 provider id（custom_*）
//
// 数据来源：各 provider 官方文档（截至 2026-05），保守取主流值。**未列出的 model 不假装
// 1M**——之前硬编码 1M cap 给用户错误的"还有大把空间"信号；保守 fallback 改 200k。
// 长期目标：等 SDK 全 provider 都接好 getEffectiveContextWindow 后整张表可删。

type CapRule = { match: RegExp; cap: number };

// 数值与 SDK 0.7.58 provider-capabilities.json 对齐（2026-07-03 复核，见 c:/tmp/caps.mjs 对比脚本）。
// **过报(over-claim)是危险方向**——会让用户误以为"还有大把空间"却提前压缩；这里逐条按 SDK 真值订正。
// 顺序敏感：更具体的规则必须在通配前面（first-match wins）。
const RULES: readonly CapRule[] = [
  // Anthropic Claude — opus 4.7 / 4.8 是 1M；其余 (haiku / opus 4.6 等) 200k。
  { match: /^claude-opus-4-[78]/, cap: 1_000_000 },
  { match: /^claude-/, cap: 200_000 },
  // OpenAI GPT-5 系列 — 现役 gpt-5.4 / gpt-5.3-codex-spark 均 400k（**旧注 1M 已过时，是过报**）。
  { match: /^gpt-5/, cap: 400_000 },
  // OpenAI GPT-4 系列 — 128k
  { match: /^gpt-4/, cap: 128_000 },
  // DeepSeek — v3.x 仍是 128k（**旧注统一 1M 是过报**）；v4 (flash/pro) 及后续 1M。
  { match: /^deepseek-v3/, cap: 128_000 },
  { match: /^deepseek-/, cap: 1_000_000 },
  // Kimi K2 系列（k2.5 / k2.6 / k2.7-code）与 Kimi for Coding — 均 256k。
  // KodaX 0.7.71 exposes two local K3 tiers over the same upstream `k3` wire model.
  { match: /^k3$/, cap: 1_048_576 },
  { match: /^k3-256k$/, cap: 262_144 },
  { match: /^kimi-k2/, cap: 256_000 },
  { match: /^kimi-for-coding/, cap: 256_000 },
  // Qwen 3.5 — 1M
  { match: /^qwen3\.5/, cap: 1_000_000 },
  // GLM-5.2 (Zhipu / Z.ai Coding Plan) - 1M; keep this before the broader GLM-5 fallback.
  { match: /^glm-5\.2$/, cap: 1_000_000 },
  // GLM-5 / GLM-5.1 / GLM-5 Turbo - 200k fallback.
  { match: /^glm-5(?:$|\.1$|-turbo$)/, cap: 200_000 },
  // GLM-4.7 - 200k.
  { match: /^glm-4\.7$/, cap: 200_000 },
  // MiniMax — M2.x 系列 (M2.7 / -highspeed) 204800（**旧注 1M 是过报**）；M3 及后续 1M。
  { match: /^MiniMax-M2/, cap: 204_800 },
  { match: /^MiniMax-M/, cap: 1_000_000 },
  // MiMo (Xiaomi) — v2.5 是 1M（旧注 128k 过时，属欠报）。
  { match: /^mimo-/, cap: 1_000_000 },
  // Doubao seed 2.0 系列 (ark-coding) — 256k
  { match: /^doubao-seed/, cap: 256_000 },
  // Gemini 3 — 2M
  { match: /^gemini-3/, cap: 2_000_000 },
];

/** Fallback 上下文窗口 — 用于没匹配上规则的 model。保守取 200k 避免误导。*/
export const DEFAULT_CONTEXT_CAP = 200_000;

/**
 * 按 model 名解析上下文窗口。匹配第一条规则的 cap；都不匹配返回 DEFAULT_CONTEXT_CAP.
 * model 为空 / undefined → fallback.
 */
export function getModelContextCap(model: string | undefined | null): number {
  if (!model) return DEFAULT_CONTEXT_CAP;
  for (const rule of RULES) {
    if (rule.match.test(model)) return rule.cap;
  }
  return DEFAULT_CONTEXT_CAP;
}

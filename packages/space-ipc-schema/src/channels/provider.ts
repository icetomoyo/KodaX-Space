// Provider 配置 channels — FEATURE_004
//
// 数据流：
//   - 列出 catalog（built-in + custom） : provider.list
//   - 写 API key（renderer → main → keychain，**永不**回传 key）: provider.setKey
//   - 删 key                                                  : provider.removeKey
//   - 测连接（main 自己用 key 试调，renderer 只看结果）       : provider.test
//   - 设默认 provider                                         : provider.setDefault
//   - 加自定义 provider（OpenAI-compat / Anthropic-compat）   : provider.addCustom
//   - 删自定义 provider                                       : provider.removeCustom
//
// 重要安全约束：API key **绝不**通过 IPC 回传给 renderer。
//   - provider.list 只回 `configured: boolean`
//   - main 进程持有 key（process.env 注入），renderer 永远只知道"是否配置"
//   - 这是 contextIsolation + sandbox 之外的第三层防御：即使 renderer 被 XSS
//     污染，attacker 也拿不到 key（因为根本没经过 renderer）

import { z } from 'zod';

// --- 共享：自定义 provider 的 reasoning 声明 ---
//
// 对齐 SDK 的 friendly 形态 KodaXReasoningConfig：`{ efforts, default } | 'none'`
// （wire strategy 由 protocol 推导，用户不碰 preset/strategy 枚举）。'none' = 无思考能力。
// 这是 Space 表单可编辑的子集；SDK 还支持 advanced 的 raw profile，Space 表单不暴露。
export const customProviderReasoningSchema = z.union([
  z.literal('none'),
  z.object({
    efforts: z.array(z.string().min(1).max(32)).min(1).max(16),
    default: z.string().min(1).max(32).optional(),
  }),
]);
export type CustomProviderReasoning = z.infer<typeof customProviderReasoningSchema>;

// --- 共享：单个 provider 描述 ---
//
// `id` 是稳定的标识符（如 'anthropic'、'zhipu-coding'）
// `displayName` 是 UI 显示用（如 'Anthropic'、'Zhipu Coding Plan'）
// `apiKeyEnv` 是 SDK 读 key 的 env var（如 'ANTHROPIC_API_KEY'）—— main 用它注入 env
// `isCustom` 区分 built-in 和用户加的自定义 provider
// `defaultModel` / `models` 给 SessionCreate 下拉选模型用
// `protocol` 标识 SDK 协议族（Anthropic / OpenAI / CLI-bridge）—— 自定义 provider 必填
const providerInfoSchema = z.object({
  id: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  apiKeyEnv: z.string().min(1).max(128),
  protocol: z.enum(['anthropic', 'openai', 'gemini-cli', 'codex-cli']),
  defaultModel: z.string().min(1).max(128),
  models: z.array(z.string().min(1).max(128)).max(64).optional(),
  configured: z.boolean(),
  configuredSource: z.enum(['none', 'keychain', 'env', 'runtime', 'both']),
  isDefault: z.boolean(),
  isCustom: z.boolean(),
  // 自定义 provider 才有；built-in 走 SDK 内置 baseUrl
  baseUrl: z.string().min(1).max(512).optional(),
  skipBaseUrlValidation: z.boolean().optional(),
  promptCacheAffinity: z.boolean().optional(),
  // 自定义 provider 的 reasoning 声明（friendly 形态）；缺省 = 未声明（走 SDK 默认能力表）
  reasoning: customProviderReasoningSchema.optional(),
});

// --- Invoke: provider.list ---
//
// keychainBackend：
//   'keychain' — OS 原生 keychain（macOS Keychain / Win CredMgr / Linux libsecret）
//   'memory'   — fallback（keytar 没装 / Linux 没 libsecret）；key 仅本进程有效，
//                进程重启后丢失。UI 应当显示明显告警，避免"我配了 key 重启就没了"
//                的 UX 完整性问题（review M1-sec）
export const providerListChannel = {
  name: 'provider.list',
  direction: 'invoke',
  input: z.undefined().optional(),
  output: z.object({
    providers: z.array(providerInfoSchema),
    defaultProviderId: z.string().min(1).max(64).nullable(),
    keychainBackend: z.enum(['keychain', 'memory']),
  }),
} as const;

// --- Invoke: provider.setKey ---
//
// API key 上限 4096：足以承载所有已知 provider 的 key（最长的是 Anthropic OAuth token
// ~200 字符），同时挡 LLM 把整段文本当 key 提交的攻击向量
export const providerSetKeyChannel = {
  name: 'provider.setKey',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
    apiKey: z.string().min(1).max(4096),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// --- Invoke: provider.removeKey ---
export const providerRemoveKeyChannel = {
  name: 'provider.removeKey',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// --- Invoke: provider.test ---
//
// "测连接" = main 用 key 发一个 minimal request（如 GET /v1/models）验证 401 vs 200。
// 不真发 LLM completion（每次测都烧 token 不合适；不同 provider 的最小调用也不一致）。
// latencyMs 取 fetch round-trip；error 是脱敏后的失败说明（"unauthorized" / "network error"），
// **不**回传 HTTP body（可能含 key 回显之类）。
export const providerTestChannel = {
  name: 'provider.test',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
  }),
  output: z.object({
    ok: z.boolean(),
    latencyMs: z.number().int().nonnegative().optional(),
    error: z.string().max(256).optional(),
  }),
} as const;

// --- Invoke: provider.setDefault ---
export const providerSetDefaultChannel = {
  name: 'provider.setDefault',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// --- Invoke: provider.addCustom ---

function isHttpsBaseUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const customProviderConfigInputSchema = z.object({
  displayName: z.string().min(1).max(128),
  protocol: z.enum(['anthropic', 'openai']),
  baseUrl: z.string().min(1).max(512),
  skipBaseUrlValidation: z.boolean().optional(),
  apiKeyEnv: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z_][A-Z0-9_]{0,127}$/, { message: 'apiKeyEnv must be uppercase snake_case' }),
  defaultModel: z.string().min(1).max(128),
  models: z.array(z.string().min(1).max(128)).max(64).optional(),
  promptCacheAffinity: z.boolean().optional(),
  reasoning: customProviderReasoningSchema.optional(),
});

function validateCustomProviderBaseUrl(
  value: { readonly baseUrl: string; readonly skipBaseUrlValidation?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (value.skipBaseUrlValidation === true) return;
  if (isHttpsBaseUrl(value.baseUrl)) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['baseUrl'],
    message: 'baseUrl must use https:// unless URL validation is skipped',
  });
}

const providerAddCustomInputSchema = customProviderConfigInputSchema.superRefine(
  validateCustomProviderBaseUrl,
);

const providerUpdateCustomInputSchema = customProviderConfigInputSchema
  .extend({
    providerId: z.string().min(1).max(64),
  })
  .superRefine(validateCustomProviderBaseUrl);

export const providerAddCustomChannel = {
  name: 'provider.addCustom',
  direction: 'invoke',
  input: providerAddCustomInputSchema,
  output: z.object({
    ok: z.boolean(),
    providerId: z.string().min(1).max(64),
  }),
} as const;

// --- Invoke: provider.updateCustom ---
export const providerUpdateCustomChannel = {
  name: 'provider.updateCustom',
  direction: 'invoke',
  input: providerUpdateCustomInputSchema,
  output: z.object({
    ok: z.boolean(),
    providerId: z.string().min(1).max(64),
  }),
} as const;

// --- Invoke: provider.removeCustom ---
export const providerRemoveCustomChannel = {
  name: 'provider.removeCustom',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;
// --- Invoke: provider.modelContextWindow ---
//
// SDK-driven 上下文窗口查询。替代 renderer 端 modelContextCaps.ts 的硬编码表。
// 主流程：
//   1. renderer ContextWindowIndicator 拿到 activeProviderId + activeModel
//   2. invoke('provider.modelContextWindow', { providerId, model })
//   3. main 调 `resolveProvider(providerId)` 拿 KodaXBaseProvider 实例
//   4. main 调 `resolveContextWindow({ enabled: true, triggerPercent: 80 }, provider, model)`
//      → SDK 内部四步级联：CompactionConfig.contextWindow → provider.getEffectiveContextWindow(model)
//        → provider.getContextWindow() → 200_000 hard fallback
//   5. renderer cache 在 Map<`${providerId}|${model}`, number> 里，model 切换时再查
//
// 为什么不一次性 `provider.list` 返回所有 model 的 contextWindow：
//   - resolveProvider 在每个 provider 实例上有 side-effect（注册到 runtime）
//   - per-model 查询响应 50ms 以内（micro-task），cache 后零成本
//   - "active model" 是稀疏访问，懒加载更合适
export const providerModelContextWindowChannel = {
  name: 'provider.modelContextWindow',
  direction: 'invoke',
  input: z.object({
    providerId: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
  }),
  output: z.object({
    contextWindow: z.number().int().positive(),
    /** SDK fallback (200k) vs provider-advertised 区分；UI 显示用 "≈" 提示。*/
    source: z.enum(['provider', 'fallback']),
    /** Effective always-on percentage trigger, normalized to 15-90. */
    compactionTriggerPercent: z.number().int().min(15).max(90),
    compactionTriggerTokens: z.number().int().positive().max(10_000_000).optional(),
    /** Final threshold after percentage, absolute, and physical-capacity limits. */
    compactionEffectiveTriggerTokens: z.number().int().positive().max(10_000_000).optional(),
    supportedEfforts: z.array(z.string().min(1).max(32)).max(16).optional(),
    defaultEffort: z.string().min(1).max(32).optional(),
    /**
     * Whether the provider can actually disable thinking (honor an "Off"/none effort). False for
     * providers that hard-reject 'none' (kimi-code / minimax-coding) — the UI hides "Off" for those
     * so it doesn't mislabel a control the runtime would silently clamp up to the weakest rung.
     */
    canDisableThinking: z.boolean().optional(),
  }),
} as const;

export type ProviderInfo = z.infer<typeof providerInfoSchema>;
export type ProviderProtocol = ProviderInfo['protocol'];

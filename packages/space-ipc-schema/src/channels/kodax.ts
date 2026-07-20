// KodaX user-level config channel — v0.1.6 cleanup
//
// 读 ~/.kodax/config.json 的"非 mcpServers"标量默认值，供 Space 在 session create 时预选。
// renderer 拿到后只读 — Space 不写回 ~/.kodax/config.json（user 走 KodaX CLI / 编辑器改）。
//
// **安全契约**：
//   - 只返回标量（string / boolean / enum），不会有 secret 进入此 payload
//   - customProviders 只暴露 count；具体配置 (apiKeyEnv 变量名 + baseUrl) 保守不投影
//   - main 端 SDK loadConfig 抛异常或冷启动失败 → fallback 全 undefined + count=0，
//     renderer 用 Space 自己的 default 走

import { z } from 'zod';

const reasoningModeSchema = z.enum(['off', 'auto', 'quick', 'balanced', 'deep']);
// 严格匹配 main loader (normalizePermissionMode) 实际产出值——KodaX 的 'default' /
// 'bypass-permissions' map 到 undefined，所以 schema 里没有它们；'auto' 是 Space 自己的模式
// 不对应 KodaX config 任何值，因此这里也没有（renderer 用 Space session create 时另行选）
const kodaxPermissionModeSchema = z.enum(['plan', 'accept-edits']);

const kodaxUserDefaultsSchema = z.object({
  /** ~/.kodax/config.json 的 `provider` 字段。Space catalog 里如果有 1:1 同 id 的会被
   *  renderer 选中作为默认 provider（首次 Space 没设 defaultProviderId 时）。*/
  provider: z.string().min(1).max(128).optional(),
  /** ~/.kodax/config.json 的 `model` 字段。session 创建后用 /model 切，这里是初值。*/
  model: z.string().min(1).max(128).optional(),
  /** thinking 默认开关 */
  thinking: z.boolean().optional(),
  /** reasoning ceiling / mode (preferred name 是 reasoningCeiling，main 已做兼容映射) */
  reasoningMode: reasoningModeSchema.optional(),
  /** 仅 'plan' / 'accept-edits'；KodaX 'default' / 'bypass-permissions' 走 undefined */
  permissionMode: kodaxPermissionModeSchema.optional(),
  /** KodaX `autoMode.engine`（环境变量覆盖已由 main 端解析）。 */
  autoModeEngine: z.enum(['llm', 'rules']).optional(),
  /** Auto LLM classifier model spec；不包含 credential。 */
  autoModeClassifierModel: z.string().min(1).max(128).optional(),
  /** Auto LLM side-query 的有效超时；0.7.72 默认 20 秒。 */
  autoModeTimeoutMs: z.number().int().positive().max(3_600_000).optional(),
  /** customProviders 个数 — 详细配置不暴露 renderer (apiKeyEnv 等敏感 hint 保守隐藏)。
   *  registerKodaxCustomProviders 已在 main boot 把这些注册到 SDK runtime；
   *  renderer 只用此 count 做 UI hint "你有 N 个 KodaX 自定义 provider 已可用，用 /provider <name> 切"。*/
  customProvidersCount: z.number().int().nonnegative().max(64),
});

// ---- Invoke: kodax.getDefaults ----
//
// 读 ~/.kodax/config.json 的默认值子集。每次调用都触一次 SDK loadConfig；
// 是否 hot-reload 取决于 SDK 内部行为，待验证。最坏情况是 Space 启动期 snapshot，
// 用户改 config 后重启 Space 可保证生效。
export const kodaxGetDefaultsChannel = {
  name: 'kodax.getDefaults',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: kodaxUserDefaultsSchema,
} as const;

export type KodaxUserDefaults = z.infer<typeof kodaxUserDefaultsSchema>;

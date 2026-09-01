// KodaX user-level config channel — v0.1.6 cleanup
//
// 读 ~/.kodax/config.json 的核心标量默认值，供 Space 在 session create 时预选。
// MCP/A2A/Extensions 已迁到 integrations/*.json，不属于这个 channel。
//
// **安全契约**：
//   - 只返回标量（string / boolean / enum），不会有 secret 进入此 payload
//   - customProviders 只暴露 count；具体配置 (apiKeyEnv 变量名 + baseUrl) 保守不投影
//   - main 端 SDK loadConfig 抛异常或冷启动失败 → fallback 全 undefined + count=0，
//     renderer 用 Space 自己的 default 走

import { z } from 'zod';
import { permissionModeSchema, reasoningModeSchema } from './session.js';

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
  /** KodaX canonical permission profile；legacy aliases 已在 main load boundary 归一化。 */
  permissionMode: permissionModeSchema.optional(),
  /** Auto LLM classifier model spec；不包含 credential。 */
  autoModeClassifierModel: z.string().min(1).max(128).optional(),
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

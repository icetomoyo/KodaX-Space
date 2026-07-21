// KX-I-01 零配置 provider 自动激活
//
// 用户首启时如果 shell rc / 系统 env 已经 export 了 ANTHROPIC_API_KEY /
// ZHIPU_API_KEY 等，Space 应当**自动**把首个匹配的 built-in provider 设为默认，
// 不再要求用户进 Settings 手动点选。
//
// 触发条件 (二者皆需)：
//   1. providerConfigStore.getDefaultProviderId() === null（从未设过默认）
//   2. 至少 1 个 built-in provider 的 apiKeyEnv 在 process.env 里有非空值
//
// 上游：shell-env-hydrate.ts 已经把用户 shell rc 的 env merge 到 process.env，
// 所以 process.env 在本函数运行时是"shell 真实状态 + Space 自己 inject 过的 keychain key"。
//
// 选择策略：按 PRIORITY 顺序选第一个 env-active 的（"coding 偏好"列表，让有 ANTHROPIC
// 和 ZHIPU 两个 key 的用户默认走 anthropic 而不是 zhipu）。
// PRIORITY 之外的 env-active 也会被记录，UI 可后续提示用户切换。
//
// 安全：本函数只调 providerConfigStore.setDefault()，不写 keychain、不读 / 不打 env value。
// 详见 ADR-006 §7.3 "KX-I-01 自动激活安全" 讨论。

import { BUILTIN_PROVIDERS } from './catalog.js';
import { providerConfigStore } from './config.js';
import { listConfiguredAccounts } from './keychain.js';

// "coding 偏好"优先级。Anthropic / Codex CLI 类 coding-first provider 排前。
// 在 PRIORITY 表里同时有 env 的 → 取最靠前；不在 PRIORITY 表里的 → 落到表尾（unknown）。
const PRIORITY: readonly string[] = [
  'anthropic',
  'codex-cli',
  'kimi-code',
  'zhipu-coding',
  'openai',
  'deepseek',
  'ark-coding',
  'minimax-coding',
  'mimo-coding',
  'qwen-token-plan',
  'qwen',
  'zhipu',
  'kimi',
  'gemini-cli',
];

// 本次启动激活过的 provider id（首次启动且 env 有 key 时非空）。
//
// **TODO(KX-I-01.2)**：renderer 端 toast wiring 暂未接入 —— 当前 getter 是
// dead-on-the-wire：值已记录但未通过 IPC channel 透出。后续 follow-up commit 应当：
//   1. 在 provider.list 输出加 `autoActivatedFromEnv?: string[]` (optional 兼容);
//   2. 或新增 push channel 'provider.auto-activated' 在主进程主动推一次;
//   3. renderer 用 toastStore 显示 "Auto-activated N providers from env: ..."
// 现状下保留 in-memory 状态 + 控制台 info log，让真正接入时不需要改 main 侧 wiring。
let autoActivatedThisBoot: readonly string[] = [];

/**
 * 启动期调用。providerConfigStore.load() + injectAllKeysToEnv() 之后再调
 * 才能保证 process.env 是最新状态。
 *
 * 首次启动逻辑：
 *   - 已有 defaultProviderId → 直接 return，不覆盖用户选择
 *   - 没 default 但 env 有 key → 按优先级挑一个 setDefault；记录全部命中以供 UI 显示
 *   - 没 default 也没 key → return（用户进 Settings 手动配）
 */
export async function autoActivateProvidersFromEnv(): Promise<void> {
  if (providerConfigStore.getDefaultProviderId() !== null) return;

  const keychainActive = new Set(
    await listConfiguredAccounts(BUILTIN_PROVIDERS.map((provider) => provider.id)),
  );
  const envActive = BUILTIN_PROVIDERS.filter((b) => {
    const v = process.env[b.apiKeyEnv];
    return (v !== undefined && v.trim().length > 0) || keychainActive.has(b.id);
  });
  if (envActive.length === 0) return;

  // 按 PRIORITY 顺序找第一个命中的
  let picked: (typeof envActive)[number] | null = null;
  for (const id of PRIORITY) {
    const found = envActive.find((b) => b.id === id);
    if (found) {
      picked = found;
      break;
    }
  }
  // PRIORITY 都没匹配（未来 SDK 新加的 provider 还没排进表里）→ 取第一个
  if (picked === null) picked = envActive[0];

  await providerConfigStore.setDefault(picked.id);
  autoActivatedThisBoot = envActive.map((b) => b.id);
  console.info(`[auto-activate] detected ${envActive.length} env key(s); default → ${picked.id}`);
}

export function getAutoActivatedThisBoot(): readonly string[] {
  return autoActivatedThisBoot;
}

/**
 * 测试 hook：重置内存状态。生产路径不该调用。
 */
export function _resetAutoActivateForTesting(): void {
  autoActivatedThisBoot = [];
}

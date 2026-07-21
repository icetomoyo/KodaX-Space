// Provider IPC handlers — FEATURE_004
//
// 7 个 invoke channel：
//   provider.list           列出 built-in + custom providers + configured 状态
//   provider.setKey         写 key（main → keychain；renderer 永不持有 key）
//   provider.removeKey      删 key
//   provider.test           HTTP probe 测连接
//   provider.setDefault     设默认 provider
//   provider.addCustom      新增自定义 provider
//   provider.removeCustom   删自定义 provider
//
// 安全约束：
//   - API key 只走 setKey 流向 main，绝不通过 list / 任何 push 回 renderer
//   - error envelope 内的错误字段已由 register.ts 兜底脱敏（不打原始 Error 对象）
//     这里再额外保证：handler 自己写的 error message 不含 key 值

import { registerChannel } from './register.js';
import {
  loadKodaxCustomProviders,
  loadKodaxCompactionConfig,
  registerKodaxCustomProviders,
  removeKodaxConfigCustomProvider,
  updateKodaxConfigCustomProvider,
} from '../kodax/user-config.js';
import {
  BUILTIN_PROVIDERS,
  isBuiltinId,
  getBuiltin,
  type BuiltinProvider,
} from '../providers/catalog.js';
import { providerConfigStore, type CustomProvider } from '../providers/config.js';
import {
  setKey,
  deleteKey,
  getKey,
  listConfiguredAccounts,
  hasKey,
  getBackendStatus,
} from '../providers/keychain.js';
import { testProvider } from '../providers/test-connection.js';
import { validateBaseUrl } from '../providers/url-guard.js';
import { validateApiKeyEnv } from '../providers/env-guard.js';
import { computeModelContextWindow } from '../providers/context-window.js';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';
import type { CustomProviderProbe } from '../providers/test-connection.js';
import { refreshDiagnosticRedactionOptions } from '../diagnostics/runtime.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

type KnownProvider = BuiltinProvider | CustomProvider | CustomProviderProbe;
type ConfiguredSource = ProviderInfo['configuredSource'];

const injectedEnvOriginals = new Map<string, string | undefined>();
let injectAllKeysToEnvQueue: Promise<void> = Promise.resolve();

async function reloadCoderConfigBestEffort(context: string): Promise<void> {
  if (!runtimeHostAdapter.isRuntimeSelected()) return;
  await runtimeHostAdapter.reloadRuntimeConfig().catch((error) => {
    console.warn(
      `[${context}] Coder daemon config reload failed:`,
      error instanceof Error ? error.message : error,
    );
  });
}

function hasNonEmptyEnvValue(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasEnvKey(apiKeyEnv: string): boolean {
  return hasNonEmptyEnvValue(process.env[apiKeyEnv]);
}

function hasExternalEnvKey(apiKeyEnv: string): boolean {
  if (injectedEnvOriginals.has(apiKeyEnv)) {
    return hasNonEmptyEnvValue(injectedEnvOriginals.get(apiKeyEnv));
  }
  return hasEnvKey(apiKeyEnv);
}

function credentialSource(
  providerId: string,
  apiKeyEnv: string,
  keychainAccounts: ReadonlySet<string>,
): ConfiguredSource {
  const hasKeychain = keychainAccounts.has(providerId);
  const hasEnv = hasExternalEnvKey(apiKeyEnv);
  if (hasKeychain && hasEnv) return 'both';
  if (hasKeychain) return 'keychain';
  if (hasEnv) return 'env';
  if (hasEnvKey(apiKeyEnv)) return 'runtime';
  return 'none';
}

export function _credentialSourceForTesting(
  providerId: string,
  apiKeyEnv: string,
  keychainAccounts: ReadonlySet<string>,
): ConfiguredSource {
  return credentialSource(providerId, apiKeyEnv, keychainAccounts);
}

export function _setManagedEnvForTesting(apiKeyEnv: string, value: string): void {
  setManagedEnv(apiKeyEnv, value);
}

export function _restoreManagedEnvsForTesting(): void {
  restoreManagedEnvs();
}

function setManagedEnv(apiKeyEnv: string, value: string): void {
  const envErr = validateApiKeyEnv(apiKeyEnv);
  if (envErr) {
    console.warn(`[provider] refusing to inject unsafe apiKeyEnv "${apiKeyEnv}": ${envErr}`);
    return;
  }
  if (!injectedEnvOriginals.has(apiKeyEnv)) {
    injectedEnvOriginals.set(apiKeyEnv, process.env[apiKeyEnv]);
  }
  process.env[apiKeyEnv] = value;
}

function restoreManagedEnvs(): void {
  for (const [apiKeyEnv, original] of injectedEnvOriginals) {
    if (original === undefined) delete process.env[apiKeyEnv];
    else process.env[apiKeyEnv] = original;
  }
  injectedEnvOriginals.clear();
}

async function listKnownProviderIds(): Promise<readonly string[]> {
  await providerConfigStore.load();
  const ids = new Set<string>();
  for (const provider of BUILTIN_PROVIDERS) ids.add(provider.id);
  for (const provider of providerConfigStore.listCustom()) ids.add(provider.id);
  for (const provider of await loadKodaxCustomProviders()) ids.add(provider.id);
  return [...ids];
}

/** 校验 apiKey 不含会破坏 HTTP header 的字符（review C2-sec：CRLF injection）。*/
function validateApiKey(key: string): string | null {
  // \r \n \0 都会让 fetch undici 的 header serializer 抛错或（在老 runtime 上）
  // 注入额外 header。明确禁止，给 UI 一个清楚的报错而不是依赖 fetch 报错
  if (/[\r\n\0]/.test(key)) {
    return 'API key cannot contain CR, LF, or NUL bytes';
  }
  return null;
}

/**
 * 把 keychain 中的 key 注入 process.env。
 *   - main 启动后调一次（载入所有已配置的 key）
 *   - setKey / removeKey 后实时增量更新 env
 *   - 注入策略：按 provider 的 apiKeyEnv（如 ANTHROPIC_API_KEY）。
 *     多个 provider 共享同一 apiKeyEnv（e.g. codex-cli + openai 都用 OPENAI_API_KEY）时，
 *     **默认 provider 的 key 胜出**——其他共享同 env 的 provider 用同一个值
 *
 * review H4-code（2026-05-17）：原本只 set，不 unset。删 key 后 env 残留——
 * UI 显示 NOT SET 但 SDK 仍能用旧 key 直到进程重启。修复：构造"本次该出现的
 * apiKeyEnv 集合"，把所有由 Space 管的 apiKeyEnv 先清空，再按集合重新填回。
 * 这样多 provider 共享 env 时也能正确处理：删了 codex-cli 但 openai 还在 → OPENAI_API_KEY 保留 openai 的 key
 *
 * review M4-sec：未知 account（旧版本残留、provider 被改名等）现在会 log warn
 * 而不是静默 drop——便于排查"我配了 key 但 SDK 看不见"
 */
export function injectAllKeysToEnv(): Promise<void> {
  const next = injectAllKeysToEnvQueue
    .then(injectAllKeysToEnvUnlocked, injectAllKeysToEnvUnlocked)
    .finally(refreshDiagnosticRedactionOptions);
  injectAllKeysToEnvQueue = next.catch(() => undefined);
  return next;
}

async function injectAllKeysToEnvUnlocked(): Promise<void> {
  await providerConfigStore.load();
  const defaultId = providerConfigStore.getDefaultProviderId();
  // 1) 收集 keychain 里实际有 key 的 apiKeyEnv 名（按 account → provider info → env name）。
  //    只清这些，留住 shell-exported 的 ZHIPU_API_KEY / DEEPSEEK_API_KEY 等 — 用户在
  //    shell rc 里 export 的 key 是 KodaX/Claude Code 等工具的常用配置方式，删了之后
  //    Space provider.list 会显示"未配置"，与用户预期完全不符 (regression discovered
  //    via e2e 测试发现：zhipu-coding 在 shell 有 ZHIPU_API_KEY 但 list 显示未配置)。
  restoreManagedEnvs();

  // 2) 按 account 重新注入；未知 account 自动清掉（旧 dev key / 测试残留）
  //    v0.1.6: 之前只 log warn 不删，导致用户启动每次报一遍"a/b/c/x skipping"。
  //    detect 条件保守：account 不匹配任何已知 provider id (built-in catalog 稳定 +
  //    custom_<hex> CSPRNG 永不重生) → 安全删除。
  if (process.platform === 'darwin') {
    if (defaultId) await ensureProviderKeyInjected(defaultId);
    return;
  }

  const accounts = await listConfiguredAccounts(await listKnownProviderIds());
  const orphanAccounts: string[] = [];
  for (const acct of accounts) {
    const info = await resolveProviderInfo(acct);
    if (!info) {
      orphanAccounts.push(acct);
      continue;
    }
    const value = await getKey(acct);
    if (value) setManagedEnv(info.apiKeyEnv, value);
  }
  if (orphanAccounts.length > 0) {
    console.info(
      `[provider] cleaning up ${orphanAccounts.length} orphan keychain account(s): ${orphanAccounts.join(', ')}`,
    );
    for (const acct of orphanAccounts) {
      try {
        await deleteKey(acct);
      } catch (err) {
        console.warn(
          `[provider] failed to delete orphan account "${acct}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  // 4) 默认 provider 的 key 最后注入一次——保证共享 env 时它胜出
  if (defaultId) {
    const info = await resolveProviderInfo(defaultId);
    if (info) {
      const value = await getKey(defaultId);
      if (value) setManagedEnv(info.apiKeyEnv, value);
    }
  }
}

async function resolveProviderInfo(id: string): Promise<{ apiKeyEnv: string } | undefined> {
  if (isBuiltinId(id)) {
    const b = getBuiltin(id);
    return b ? { apiKeyEnv: b.apiKeyEnv } : undefined;
  }
  const c = providerConfigStore.getCustom(id);
  if (c) return { apiKeyEnv: c.apiKeyEnv };
  const sdkCustom = (await loadKodaxCustomProviders()).find((p) => p.id === id);
  return sdkCustom ? { apiKeyEnv: sdkCustom.apiKeyEnv } : undefined;
}

async function resolveCredentialAccountForProvider(
  providerId: string,
  apiKeyEnv: string,
): Promise<string | undefined> {
  if (await hasKey(providerId)) return providerId;
  for (const candidateId of await listKnownProviderIds()) {
    if (candidateId === providerId) continue;
    const candidateInfo = await resolveProviderInfo(candidateId);
    if (candidateInfo?.apiKeyEnv !== apiKeyEnv) continue;
    if (await hasKey(candidateId)) return candidateId;
  }
  return undefined;
}

export async function ensureProviderKeyInjected(providerId: string): Promise<boolean> {
  if (providerId === 'mock') return false;
  await providerConfigStore.load();
  const info = await resolveProviderInfo(providerId);
  if (!info) return false;
  const credentialAccount = await resolveCredentialAccountForProvider(providerId, info.apiKeyEnv);
  if (!credentialAccount) return false;
  const value = await getKey(credentialAccount);
  if (!value) return false;
  setManagedEnv(info.apiKeyEnv, value);
  return true;
}

/**
 * Main-process-only credential lookup for the daemon credential broker.
 * The value is returned only to a trusted callback and never crosses IPC.
 */
export async function readProviderCredential(providerId: string): Promise<string | undefined> {
  if (providerId === 'mock') return undefined;
  await providerConfigStore.load();
  const info = await resolveProviderInfo(providerId);
  if (!info) return undefined;
  const account = await resolveCredentialAccountForProvider(providerId, info.apiKeyEnv);
  const stored = account ? await getKey(account) : undefined;
  if (hasNonEmptyEnvValue(stored)) return stored;
  const fromEnv = process.env[info.apiKeyEnv];
  return hasNonEmptyEnvValue(fromEnv) ? fromEnv : undefined;
}

async function resolveKnownProvider(id: string): Promise<KnownProvider | undefined> {
  if (isBuiltinId(id)) return getBuiltin(id);
  await providerConfigStore.load();
  const custom = providerConfigStore.getCustom(id);
  if (custom) return custom;
  return (await loadKodaxCustomProviders()).find((p) => p.id === id);
}

async function refreshSdkCustomProviderRegistry(): Promise<void> {
  await providerConfigStore.load();
  await registerKodaxCustomProviders(providerConfigStore.listCustom(), { force: true });
}

export function registerProviderChannels(): void {
  // provider.list
  registerChannel('provider.list', async () => {
    await providerConfigStore.load();
    const keychainAccounts = new Set(await listConfiguredAccounts(await listKnownProviderIds()));
    const defaultId = providerConfigStore.getDefaultProviderId();

    // v0.1.6：configured 同时认两种来源——
    //   1) Space keychain 里存了 key (写时同时注入 process.env[apiKeyEnv])
    //   2) Space 启动前 shell 已经 export 了 apiKeyEnv (用户本地直接配 env，不走 Space 设置)
    // 之前只看 keychain，导致用户在 shell export 过 KIMI_API_KEY/ARK_API_KEY 等的 provider
    // 显示成 not configured，UI 让人困惑。
    const list: ProviderInfo[] = [];
    const seenProviderIds = new Set<string>();

    // catalog 模块顶层已经从 SDK JSON 单一事实源 load 完整 provider 数据 ——
    // BuiltinProvider 的 apiKeyEnv / defaultModel / models 就是 SDK 的真相，
    // 不再需要每次 provider.list 调用时二次 dynamic-import SDK 取值。
    for (const b of BUILTIN_PROVIDERS) {
      const source = credentialSource(b.id, b.apiKeyEnv, keychainAccounts);
      seenProviderIds.add(b.id);
      list.push({
        id: b.id,
        displayName: b.displayName,
        apiKeyEnv: b.apiKeyEnv,
        protocol: b.protocol,
        defaultModel: b.defaultModel,
        models: b.models ? [...b.models] : undefined,
        configured: source !== 'none',
        configuredSource: source,
        isDefault: defaultId === b.id,
        isCustom: false,
      });
    }
    for (const c of providerConfigStore.listCustom()) {
      const source = credentialSource(c.id, c.apiKeyEnv, keychainAccounts);
      seenProviderIds.add(c.id);
      list.push({
        id: c.id,
        displayName: c.displayName,
        apiKeyEnv: c.apiKeyEnv,
        protocol: c.protocol,
        defaultModel: c.defaultModel,
        models: c.models ? [...c.models] : undefined,
        configured: source !== 'none',
        configuredSource: source,
        isDefault: defaultId === c.id,
        isCustom: true,
        baseUrl: c.baseUrl,
        skipBaseUrlValidation: c.skipBaseUrlValidation,
        ...(c.reasoning !== undefined ? { reasoning: c.reasoning } : {}),
      });
    }
    for (const c of await loadKodaxCustomProviders()) {
      if (seenProviderIds.has(c.id)) continue;
      const source = credentialSource(c.id, c.apiKeyEnv, keychainAccounts);
      seenProviderIds.add(c.id);
      list.push({
        id: c.id,
        displayName: c.displayName,
        apiKeyEnv: c.apiKeyEnv,
        protocol: c.protocol,
        defaultModel: c.defaultModel,
        models: c.models ? [...c.models] : undefined,
        configured: source !== 'none',
        configuredSource: source,
        isDefault: defaultId === c.id,
        isCustom: true,
        baseUrl: c.baseUrl,
        skipBaseUrlValidation: c.skipBaseUrlValidation,
        ...(c.reasoning !== undefined ? { reasoning: c.reasoning } : {}),
      });
    }

    const effectiveDefaultId =
      defaultId && list.some((p) => p.id === defaultId && p.configured) ? defaultId : null;
    const providers = list.map((p) => ({ ...p, isDefault: p.id === effectiveDefaultId }));
    const keychainBackend = await getBackendStatus();
    return { providers, defaultProviderId: effectiveDefaultId, keychainBackend };
  });

  // provider.setKey — renderer 把 key 推给 main 后立即写 keychain + 注入 env
  registerChannel('provider.setKey', async (input) => {
    if (!(await resolveKnownProvider(input.providerId))) {
      // 未知 provider — 拒绝（防 LLM 诱导写 key 到任意 account 名占用 keychain 空间）
      throw new Error('unknown providerId');
    }
    // C2-sec：拒绝含 CRLF/NUL 的 key
    const keyErr = validateApiKey(input.apiKey);
    if (keyErr) throw new Error(keyErr);

    await setKey(input.providerId, input.apiKey);
    await injectAllKeysToEnv();
    return { ok: true };
  });

  // provider.removeKey
  registerChannel('provider.removeKey', async (input) => {
    const removed = await deleteKey(input.providerId);
    // 重新跑一遍全量注入——如果该 provider 跟其他共享 apiKeyEnv，
    // 删它的 key 之后那个 env 应回到另一个共享者的值（或被默认 provider 覆盖）
    await injectAllKeysToEnv();
    return { ok: removed };
  });

  // provider.test
  registerChannel('provider.test', async (input) => {
    const probe = await resolveKnownProvider(input.providerId);
    if (!probe) {
      return { ok: false, error: 'unknown provider' };
    }
    // 轻量 sync 预检：仅对 builtin —— builtin 的 apiKeyEnv 规范唯一，env 没 key 直接给即时反馈。
    // custom provider 的 apiKeyEnv 可能复用 builtin env 名（如自建 Anthropic 网关用
    // ANTHROPIC_API_KEY），预检会因别的 provider 设了同名 env 而误判通过 → 不预检，交给 SDK 的
    // verifyProviderCredential 按 provider 真实凭证返 'unconfigured'，更准确。
    await ensureProviderKeyInjected(input.providerId);
    if (isBuiltinId(input.providerId) && !hasEnvKey(probe.apiKeyEnv)) {
      return { ok: false, error: 'no API key configured' };
    }
    return testProvider(probe, { timeoutMs: 8000 });
  });

  // provider.setDefault
  registerChannel('provider.setDefault', async (input) => {
    const provider = await resolveKnownProvider(input.providerId);
    if (!provider) {
      throw new Error('unknown providerId');
    }
    await ensureProviderKeyInjected(input.providerId);
    const source = credentialSource(
      input.providerId,
      provider.apiKeyEnv,
      (await hasKey(input.providerId)) ? new Set([input.providerId]) : new Set<string>(),
    );
    if (source === 'none') {
      throw new Error('provider is not configured; add an API key before setting it as default');
    }
    await providerConfigStore.setDefault(input.providerId);
    // 切默认 provider 时重新注入——共享 env 时让它胜出
    await injectAllKeysToEnv();
    await reloadCoderConfigBestEffort('provider.setDefault');
    return { ok: true };
  });

  // provider.addCustom
  //
  // 三道校验门：
  //   1) baseUrl 必须是 https://、不是 IP literal、hostname 不在内网黑名单（C1-sec SSRF）
  //   2) apiKeyEnv 是合法的 env var 名 + 不在 reserved blocklist（H2-sec NODE_OPTIONS 注入）
  //   3) displayName / defaultModel 由 schema 已经限了长度
  registerChannel('provider.addCustom', async (input) => {
    const urlCheck = validateBaseUrl(input.baseUrl, {
      skipValidation: input.skipBaseUrlValidation === true,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      throw new Error(`baseUrl rejected: ${urlCheck.error}`);
    }
    const envErr = validateApiKeyEnv(input.apiKeyEnv);
    if (envErr) throw new Error(envErr);

    const id = await providerConfigStore.addCustom({
      displayName: input.displayName,
      protocol: input.protocol,
      baseUrl: urlCheck.normalizedUrl,
      skipBaseUrlValidation: input.skipBaseUrlValidation === true ? true : undefined,
      apiKeyEnv: input.apiKeyEnv,
      defaultModel: input.defaultModel,
      models: input.models,
      ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    });
    await refreshSdkCustomProviderRegistry();
    await reloadCoderConfigBestEffort('provider.addCustom');
    return { ok: true, providerId: id };
  });

  // provider.updateCustom
  registerChannel('provider.updateCustom', async (input) => {
    await providerConfigStore.load();

    const urlCheck = validateBaseUrl(input.baseUrl, {
      skipValidation: input.skipBaseUrlValidation === true,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      throw new Error(`baseUrl rejected: ${urlCheck.error}`);
    }
    const envErr = validateApiKeyEnv(input.apiKeyEnv);
    if (envErr) throw new Error(envErr);

    const update = {
      displayName: input.displayName,
      protocol: input.protocol,
      baseUrl: urlCheck.normalizedUrl,
      skipBaseUrlValidation: input.skipBaseUrlValidation === true ? true : undefined,
      apiKeyEnv: input.apiKeyEnv,
      defaultModel: input.defaultModel,
      models: input.models,
      ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    };

    let nextProviderId = input.providerId;
    if (providerConfigStore.getCustom(input.providerId)) {
      const updated = await providerConfigStore.updateCustom(input.providerId, update);
      if (!updated) {
        throw new Error('unknown writable custom providerId');
      }
    } else {
      const nextProviderIdCandidate = input.displayName.trim();
      if (nextProviderIdCandidate !== input.providerId) {
        if (isBuiltinId(nextProviderIdCandidate)) {
          throw new Error(
            `custom providerId conflicts with built-in provider: ${nextProviderIdCandidate}`,
          );
        }
        if (providerConfigStore.getCustom(nextProviderIdCandidate)) {
          throw new Error(
            `custom providerId conflicts with an existing Space provider: ${nextProviderIdCandidate}`,
          );
        }
        const collidingConfigProvider = (await loadKodaxCustomProviders()).some(
          (provider) => provider.id === nextProviderIdCandidate && provider.id !== input.providerId,
        );
        if (collidingConfigProvider) {
          throw new Error(
            `custom providerId conflicts with an existing KodaX config provider: ${nextProviderIdCandidate}`,
          );
        }
      }

      const existingKey =
        nextProviderIdCandidate !== input.providerId ? await getKey(input.providerId) : undefined;
      let keyMoved = false;
      if (existingKey) {
        await setKey(nextProviderIdCandidate, existingKey);
        const oldKeyRemoved = await deleteKey(input.providerId);
        if (!oldKeyRemoved) {
          await deleteKey(nextProviderIdCandidate).catch(() => undefined);
          throw new Error('failed to remove old provider key during rename');
        }
        keyMoved = true;
      }

      let updated: Awaited<ReturnType<typeof updateKodaxConfigCustomProvider>>;
      try {
        updated = await updateKodaxConfigCustomProvider(input.providerId, update);
        if (!updated.updated) {
          throw new Error('unknown writable custom providerId');
        }
      } catch (err) {
        if (keyMoved && existingKey) {
          await setKey(input.providerId, existingKey).catch(() => undefined);
          await deleteKey(nextProviderIdCandidate).catch(() => undefined);
        }
        throw err;
      }
      nextProviderId = updated.providerId;
      if (nextProviderId !== input.providerId) {
        if (keyMoved && nextProviderId !== nextProviderIdCandidate && existingKey) {
          await setKey(nextProviderId, existingKey);
          await deleteKey(nextProviderIdCandidate).catch(() => undefined);
        }
        if (providerConfigStore.getDefaultProviderId() === input.providerId) {
          await providerConfigStore.setDefault(nextProviderId);
        }
      }
    }

    await refreshSdkCustomProviderRegistry();
    await injectAllKeysToEnv();
    await reloadCoderConfigBestEffort('provider.updateCustom');
    return { ok: true, providerId: nextProviderId };
  });
  // provider.removeCustom
  registerChannel('provider.removeCustom', async (input) => {
    await providerConfigStore.load();
    let removed = await providerConfigStore.removeCustom(input.providerId);
    if (!removed) {
      removed = await removeKodaxConfigCustomProvider(input.providerId);
      if (removed && providerConfigStore.getDefaultProviderId() === input.providerId) {
        await providerConfigStore.clearDefault();
      }
    }
    if (removed) {
      // 删 custom 时同步删 keychain 中的 key
      await deleteKey(input.providerId);
      await injectAllKeysToEnv();
      if (input.providerId !== 'mock' && !isBuiltinId(input.providerId)) {
        await refreshSdkCustomProviderRegistry();
      }
      await reloadCoderConfigBestEffort('provider.removeCustom');
    }
    return { ok: removed };
  });
  // provider.modelContextWindow — SDK-driven 上下文窗口查询
  //
  // 替代之前 renderer 端 modelContextCaps.ts 的硬编码表。SDK runtime 用 resolveContextWindow
  // 决定真正的 compaction 触发窗口；UI 用同一函数 = single source of truth.
  //
  // Custom provider (`custom_*` id) 不进 SDK resolveProvider — 走 catalog hardcoded fallback
  // 或者 200k 默认（SDK 的 hard fallback 也是 200k）。
  //
  // Lazy SDK import — main bundle 是 CJS，SDK 是 ESM-only subpath；必须 `await import`
  // 否则撞 ERR_PACKAGE_PATH_NOT_EXPORTED（同 sdk-providers.ts 的处理）。
  registerChannel('provider.modelContextWindow', async (input) => {
    const configuredCompaction = await loadKodaxCompactionConfig();
    const compaction = {
      enabled: configuredCompaction?.enabled ?? true,
      triggerPercent: configuredCompaction?.triggerPercent ?? 75,
      ...(configuredCompaction?.triggerTokens
        ? { triggerTokens: configuredCompaction.triggerTokens }
        : {}),
      ...(configuredCompaction?.contextWindow !== undefined
        ? { contextWindow: configuredCompaction.contextWindow }
        : {}),
    };
    try {
      if (input.providerId !== 'mock' && !isBuiltinId(input.providerId)) {
        await refreshSdkCustomProviderRegistry();
      }
      const [{ resolveProvider }, { resolveContextWindow }, { resolveModelCapabilities }] =
        await Promise.all([
          import('@kodax-ai/kodax/coding'),
          import('@kodax-ai/kodax/agent'),
          import('@kodax-ai/kodax/llm'),
        ]);
      const provider = resolveProvider(input.providerId);
      const capabilities = resolveModelCapabilities(input.providerId, input.model);
      // 上下文窗口走 SDK runtime-authoritative 级联（= runtime 决定 compaction 触发的同一算法），
      // 而非 resolveModelCapabilities().contextWindow（0.7.58 default-model bug 会返回 200k）。
      // 逻辑 + 回归守卫见 providers/context-window.ts / context-window.test.ts。
      const { contextWindow: cw, source } = computeModelContextWindow(
        provider as { getEffectiveContextWindow?: unknown; getContextWindow?: unknown },
        input.model,
        resolveContextWindow,
        compaction,
      );
      // Reasoning 效力档同理走 provider.getReasoningProfile(model)（走 model 级 descriptor,
      // 不受 0.7.58 default-model bug 影响）；capabilities.reasoningProfile 仅作 provider 无此
      // 方法时的兜底。今天两处数据碰巧一致,但 default model 的 reasoningProfile 迟早会与
      // provider 级快照分叉(与 contextWindow 同一类漂移),锚定 model 级 resolver 才稳。
      type ReasoningProfileT = NonNullable<typeof capabilities>['reasoningProfile'];
      const providerReasoningProfile = (
        provider as { getReasoningProfile?: (model: string) => ReasoningProfileT }
      ).getReasoningProfile?.(input.model);
      const reasoningProfile = providerReasoningProfile ?? capabilities?.reasoningProfile;
      const supportedEfforts = reasoningProfile?.supportedEfforts
        ?.filter((effort) => effort.isUserVisible !== false)
        .map((effort) => effort.value);
      const defaultEffort =
        reasoningProfile?.defaultEffort ??
        reasoningProfile?.supportedEfforts?.find((effort) => effort.isDefault)?.value;
      // "Off" is only honorable when the provider doesn't HARD-reject the 'none' effort. kimi-code /
      // minimax-coding localRejectEfforts=['none','minimal'] → can't disable thinking; the picker
      // hides "Off" for those (else it mislabels a control the runtime clamps up to the weakest rung).
      // Anthropic disables via a separate `thinking` flag and doesn't localReject none → stays true.
      const localRejectEfforts =
        (reasoningProfile as { localRejectEfforts?: readonly string[] } | undefined)
          ?.localRejectEfforts ?? [];
      const canDisableThinking = !localRejectEfforts.includes('none');
      return {
        contextWindow: cw,
        source,
        compactionTriggerPercent: compaction.triggerPercent,
        ...(compaction.triggerTokens
          ? { compactionTriggerTokens: compaction.triggerTokens }
          : {}),
        ...(supportedEfforts && supportedEfforts.length > 0 ? { supportedEfforts } : {}),
        ...(defaultEffort ? { defaultEffort } : {}),
        canDisableThinking,
      };
    } catch (err) {
      // resolveProvider 不识别 custom_* id 时会 throw — 报 fallback 200k 让 UI 渲染
      // 而不是阻断。renderer 自己的 modelContextCaps.ts 还能作为二级 fallback (从 SDK 升上
      // 来期间).
      console.warn(
        `[provider.modelContextWindow] SDK resolve failed for ${input.providerId}/${input.model}:`,
        err instanceof Error ? err.message : err,
      );
      return {
        contextWindow: compaction.contextWindow ?? 200_000,
        source: compaction.contextWindow !== undefined ? 'provider' : 'fallback',
        compactionTriggerPercent: compaction.triggerPercent,
        ...(compaction.triggerTokens
          ? { compactionTriggerTokens: compaction.triggerTokens }
          : {}),
      };
    }
  });
}

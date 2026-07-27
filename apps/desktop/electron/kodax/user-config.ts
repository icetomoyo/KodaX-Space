// KodaX user-level config reader — v0.1.6 cleanup
//
// 读 ~/.kodax/config.json 的"非 mcpServers"字段，作为 Space 的 session 默认值来源：
//   - provider / model / thinking / reasoningMode / permissionMode → 新 session preselect
//   - customProviders → 通过 SDK registerConfiguredCustomProviders 注册到运行时 LLM registry，
//                       让 `/provider <name>` 直接可切（即使 Space Provider 面板不展示）
//
// 与 mcp/config-reader.ts 同套路：
//   - lazy load + DI（避免在模块初始化阶段加载完整 SDK，并允许单元测试注入）
//   - prewarm 在 main boot 阶段触发，不阻塞窗口
//
// **安全契约**：
//   - customProviders 数组永不离开 main（含 apiKeyEnv 字段是引用 env 变量名，但保守起见
//     不投影到 renderer）；只暴露 count
//   - 默认值是 string / boolean / enum 标量，无 secret 风险

// 不直接 import Space 的 PermissionMode（含 'auto'，KodaX 不会产生），改用窄子集。

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  KODAX_COMPACTION_TRIGGER_PERCENT_MAX,
  KODAX_COMPACTION_TRIGGER_PERCENT_MIN,
  type CustomProviderReasoning,
  type KodaxCompactionSettingsT,
  type KodaxConfigOverviewT,
} from '@kodax-space/space-ipc-schema';
import { validateApiKeyEnv } from '../providers/env-guard.js';
import { validateBaseUrl } from '../providers/url-guard.js';
import { getKodaxRuntimeDir } from './data-paths.js';
import { effortToReasoningMode, isSpaceReasoningMode } from './reasoning-effort.js';

type SdkRootModule = typeof import('@kodax-ai/kodax');
type SdkLoadConfigReturn = ReturnType<SdkRootModule['loadConfig']>;
type SdkWritableConfig = SdkLoadConfigReturn & Record<string, unknown>;
type SdkCustomProviderConfig = NonNullable<SdkLoadConfigReturn['customProviders']>[number];

/** KodaX permissionMode 中能映射到 Space 的子集（'plan' / 'accept-edits'；其它 → undefined）。*/
type KodaxMappablePermissionMode = 'plan' | 'accept-edits';

/** Space 关心的子集 — schema 暴露给 renderer 时只露这些标量。 */
export interface KodaxUserDefaults {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: boolean;
  readonly reasoningMode?: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  readonly permissionMode?: KodaxMappablePermissionMode;
  readonly autoModeEngine?: 'llm' | 'rules';
  readonly autoModeClassifierModel?: string;
  readonly autoModeTimeoutMs?: number;
  readonly autoModeSpeculativeWindowMs?: number;
  /** customProviders 数量；具体配置不暴露给 renderer（SDK runtime 已注册可用）。*/
  readonly customProvidersCount: number;
}

export interface KodaxAutoModeDefaults {
  readonly engine: 'llm' | 'rules';
  readonly classifierModel?: string;
  readonly timeoutMs: number;
  readonly speculativeWindowMs?: number;
}

/** KodaX 0.7.77 Auto LLM defaults. Keep explicit at the Space/Session boundary. */
export const KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS = 20_000;

export interface KodaxConfigCustomProvider {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
  readonly skipBaseUrlValidation?: boolean;
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
  readonly models?: readonly string[];
  readonly promptCacheAffinity?: boolean;
  readonly reasoning?: CustomProviderReasoning;
}

export interface KodaxConfigCustomProviderUpdate {
  readonly displayName: string;
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
  readonly skipBaseUrlValidation?: boolean;
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
  readonly models?: readonly string[];
  readonly promptCacheAffinity?: boolean;
  readonly reasoning?: CustomProviderReasoning;
}
export interface SpaceCustomProviderForSdk {
  readonly id: string;
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
  readonly skipBaseUrlValidation?: boolean;
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
  readonly models?: readonly string[];
  readonly promptCacheAffinity?: boolean;
  readonly reasoning?: CustomProviderReasoning;
}

export interface KodaxUserConfigImpl {
  /** SDK loadConfig — 返回完整 config 对象（main 端使用） */
  readonly loadConfig: () => SdkLoadConfigReturn;
  /** SDK saveConfig — 写回 ~/.kodax/config.json */
  readonly saveConfig?: (config: SdkLoadConfigReturn) => void;
  /** SDK registerConfiguredCustomProviders — 注册到运行时 LLM registry */
  readonly registerCustomProviders: (config: {
    customProviders?: SdkCustomProviderConfig[];
  }) => void;
}

let sdkModuleCache: SdkRootModule | null = null;
async function loadSdkRootModule(): Promise<SdkRootModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax');
  }
  return sdkModuleCache;
}

const DEFAULT_IMPL: KodaxUserConfigImpl = {
  loadConfig: () => {
    if (sdkModuleCache === null) {
      void loadSdkRootModule(); // trigger lazy load 不 await
      return {};
    }
    return sdkModuleCache.loadConfig();
  },
  saveConfig: (config) => {
    if (sdkModuleCache === null) {
      throw new Error('SDK root module is not loaded');
    }
    sdkModuleCache.saveConfig(config);
  },
  registerCustomProviders: (config) => {
    if (sdkModuleCache === null) {
      void loadSdkRootModule();
      return; // 第一次冷调静默 skip，prewarm 后下次 OK
    }
    sdkModuleCache.registerConfiguredCustomProviders(config);
  },
};

let activeImpl: KodaxUserConfigImpl = DEFAULT_IMPL;

/** 测试用：注入 mock。 */
export function setUserConfigImpl(impl: KodaxUserConfigImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
  invalidateUserDefaultsCache(); // 切 impl 必清缓存，否则 mock 之后还读到生产值
}

/**
 * 启动期把 SDK chunk 拉热——让首次 IPC `kodax.getDefaults` 不命中空 fallback。
 * 失败不致命，下次调用时 lazy load 还会重试。
 */
export async function prewarmKodaxUserConfig(): Promise<void> {
  if (sdkModuleCache !== null) return;
  try {
    await loadSdkRootModule();
  } catch (err) {
    console.warn('[kodax-user-config] prewarm failed:', err instanceof Error ? err.message : err);
  }
}

// 模块级缓存——KodaX config.json 不由 Space 进程写，所以"首次读 → 缓存"在
// Space 生命周期内安全（用户在 KodaX CLI 端改 config 必须 restart Space 才生效，
// 这与 KodaX CLI 自身行为一致：CLI 启动时 snapshot config，不监听 fs.watch）。
// 之前 session.list 每次都 await activeImpl.loadConfig() —— 命中 SDK 内部 fast
// path cache 后仍有 ~10-30ms 开销，再加 zod/normalize 计算几次/秒下来累 100ms+。
let userDefaultsCache: KodaxUserDefaults | null = null;
let userDefaultsPromise: Promise<KodaxUserDefaults> | null = null;

/** 测试钩子：mock setUserConfigImpl 后清缓存让下一次重读。 */
export function invalidateUserDefaultsCache(): void {
  userDefaultsCache = null;
  userDefaultsPromise = null;
}

/**
 * 读 ~/.kodax/config.json 投影成 Space 的默认值子集。
 *
 * **冷启动同步化**：与 mcp/config-reader 同 — mock (test) short-circuit；生产首次调用
 * 必要时 await SDK chunk load，防 prewarm 还没完就被 IPC 命中。
 *
 * **缓存**：首次调用结果在 module 级缓存命中后续所有调用。并发首调走同一 Promise
 * (避免 5 个 session.list 同时打过来发起 5 次 SDK loadConfig)。
 */
export async function loadKodaxUserDefaults(): Promise<KodaxUserDefaults> {
  if (userDefaultsCache !== null) return userDefaultsCache;
  if (userDefaultsPromise !== null) return userDefaultsPromise;
  userDefaultsPromise = computeUserDefaults().then((value) => {
    userDefaultsCache = value;
    userDefaultsPromise = null;
    return value;
  });
  return userDefaultsPromise;
}

/**
 * Runtime sessions do not load the REPL's `autoMode` config path themselves.
 * Resolve the same file/env precedence in Space and always materialize the 0.7.72
 * timeout so a stale implicit daemon default cannot silently change behaviour.
 */
export async function loadKodaxAutoModeDefaults(): Promise<KodaxAutoModeDefaults> {
  const defaults = await loadKodaxUserDefaults();
  return {
    engine: defaults.autoModeEngine ?? 'llm',
    ...(defaults.autoModeClassifierModel !== undefined
      ? { classifierModel: defaults.autoModeClassifierModel }
      : {}),
    timeoutMs: defaults.autoModeTimeoutMs ?? KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS,
    ...(defaults.autoModeSpeculativeWindowMs !== undefined
      ? { speculativeWindowMs: defaults.autoModeSpeculativeWindowMs }
      : {}),
  };
}

async function computeUserDefaults(): Promise<KodaxUserDefaults> {
  // mock 注入 → 直接走；生产首调 await chunk
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      console.warn(
        '[kodax-user-config] SDK load failed in loadKodaxUserDefaults:',
        err instanceof Error ? err.message : err,
      );
      return { customProvidersCount: 0 };
    }
  }

  let raw: SdkLoadConfigReturn;
  try {
    raw = activeImpl.loadConfig();
  } catch (err) {
    // SDK loadConfig 不应抛（损坏的 config.json SDK 自己 fallback {}），但保守 try/catch
    console.warn(
      '[kodax-user-config] SDK loadConfig threw:',
      err instanceof Error ? err.message : err,
    );
    return { customProvidersCount: 0 };
  }

  // KodaX 0.7.57 起首选 effort；reasoningCeiling/reasoningMode 仅作为旧配置兼容。
  // Space IPC 仍暴露旧 5 档枚举，因此这里先映射回现有字段。
  const reasoningMode =
    effortToReasoningMode(raw.effort) ??
    normalizeReasoningMode(raw.reasoningCeiling ?? raw.reasoningMode);
  const autoMode = (await loadSdkRootModule()).resolveAutoModeSettings({
    settings: raw.autoMode,
    env: process.env,
  });

  return {
    provider:
      typeof raw.provider === 'string' && raw.provider.length > 0 ? raw.provider : undefined,
    model: typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : undefined,
    thinking: typeof raw.thinking === 'boolean' ? raw.thinking : undefined,
    reasoningMode,
    permissionMode: normalizePermissionMode(raw.permissionMode),
    autoModeEngine: autoMode.engine,
    ...(autoMode.classifierModelEnv !== undefined || autoMode.classifierModel !== undefined
      ? { autoModeClassifierModel: autoMode.classifierModelEnv ?? autoMode.classifierModel }
      : {}),
    autoModeTimeoutMs: autoMode.timeoutMs ?? KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS,
    ...(autoMode.speculativeWindowMs !== undefined
      ? { autoModeSpeculativeWindowMs: autoMode.speculativeWindowMs }
      : {}),
    customProvidersCount: Array.isArray(raw.customProviders) ? raw.customProviders.length : 0,
  };
}

/**
 * Boot 时调一次，把 KodaX config 的 customProviders 注册到 SDK 运行时 LLM registry。
 * 注册后 `/provider <name>` 能直接切到 KodaX-CLI 配的自定义 provider（如 newapi-anthropic）。
 *
 * **失败不阻塞启动**——customProviders 不可用最多让用户没法用那几个 provider，built-in 仍 OK。
 * **不打印 customProviders 详情**——apiKeyEnv 是变量名不是值，但保守起见只 log count。
 */
export async function loadKodaxCustomProviders(): Promise<readonly KodaxConfigCustomProvider[]> {
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      console.warn(
        '[kodax-user-config] SDK load failed in loadKodaxCustomProviders:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  let raw: SdkLoadConfigReturn;
  try {
    raw = activeImpl.loadConfig();
  } catch (err) {
    console.warn(
      '[kodax-user-config] SDK loadConfig threw in loadKodaxCustomProviders:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  return normalizeKodaxConfigCustomProviders(raw.customProviders);
}

export async function loadKodaxConfigOverview(projectRoot?: string): Promise<KodaxConfigOverviewT> {
  const configPath = getKodaxConfigPath();
  const errors: KodaxConfigOverviewT['errors'] = [];
  const raw = await loadRawConfigForOverview(configPath, errors);
  return buildKodaxConfigOverview(raw, projectRoot, errors);
}

export async function updateKodaxCompactionConfig(
  compaction: KodaxCompactionSettingsT,
  projectRoot?: string,
): Promise<KodaxConfigOverviewT> {
  const raw = (await loadWritableKodaxConfig()) as SdkWritableConfig;
  const normalized = normalizeCompactionSettings(compaction);
  const next: SdkWritableConfig = { ...raw };
  next.compaction = mergeCompactionSettings(raw.compaction, normalized);
  saveWritableKodaxConfig(next as SdkLoadConfigReturn);
  return loadKodaxConfigOverview(projectRoot);
}

export async function loadKodaxCompactionConfig(): Promise<KodaxCompactionSettingsT | undefined> {
  try {
    const raw = (await loadWritableKodaxConfig()) as SdkWritableConfig;
    const normalized = normalizeCompactionSettings(raw.compaction);
    return normalized;
  } catch (err) {
    console.warn(
      '[kodax-user-config] compaction config ignored:',
      err instanceof Error ? err.message : err,
    );
    return { enabled: true };
  }
}

export async function updateKodaxConfigCustomProvider(
  providerId: string,
  update: KodaxConfigCustomProviderUpdate,
): Promise<{ readonly updated: boolean; readonly providerId: string }> {
  const raw = await loadWritableKodaxConfig();
  const providers = Array.isArray(raw.customProviders) ? [...raw.customProviders] : [];
  const index = providers.findIndex((provider) => providerName(provider) === providerId);
  if (index < 0) return { updated: false, providerId };

  const nextProviderId = update.displayName.trim();
  if (!isSafeProviderId(nextProviderId)) {
    throw new Error('KodaX config custom provider name must be a safe provider id');
  }
  const duplicateConfigProvider = providers.some(
    (provider, providerIndex) =>
      providerIndex !== index && providerName(provider) === nextProviderId,
  );
  if (duplicateConfigProvider) {
    throw new Error(`KodaX config custom provider name already exists: ${nextProviderId}`);
  }

  // Merge, don't replace: this config record is shared with the KodaX CLI, which may
  // have set fields Space does not model (reasoningProfile / supportsThinking, custom
  // headers, etc.). A full rebuild from the narrow form field set would silently discard
  // them. Space's MODELED fields (CUSTOM_PROVIDER_MODELED_KEYS — incl. `reasoning`, which
  // the form owns) are fully replaced by the rebuild, so clearing them (e.g. emptying the
  // model list or the reasoning declaration) actually takes effect; every other field on
  // the existing record is preserved.
  const existing = providers[index] as unknown as Record<string, unknown>;
  const rebuilt = customProviderUpdateToSdk(nextProviderId, update) as unknown as Record<
    string,
    unknown
  >;
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!CUSTOM_PROVIDER_MODELED_KEYS.has(key)) preserved[key] = value;
  }
  providers[index] = { ...preserved, ...rebuilt } as unknown as SdkCustomProviderConfig;
  const nextConfig = {
    ...raw,
    provider: raw.provider === providerId ? nextProviderId : raw.provider,
    customProviders: providers,
  };
  saveWritableKodaxConfig(nextConfig);
  return { updated: true, providerId: nextProviderId };
}

export async function removeKodaxConfigCustomProvider(providerId: string): Promise<boolean> {
  const raw = await loadWritableKodaxConfig();
  const providers = Array.isArray(raw.customProviders) ? [...raw.customProviders] : [];
  const nextProviders = providers.filter((provider) => providerName(provider) !== providerId);
  if (nextProviders.length === providers.length) return false;

  const nextConfig = {
    ...raw,
    provider: raw.provider === providerId ? undefined : raw.provider,
    customProviders: nextProviders,
  };
  saveWritableKodaxConfig(nextConfig);
  return true;
}
export async function registerKodaxCustomProviders(
  spaceCustomProviders: readonly SpaceCustomProviderForSdk[] = [],
  options: { readonly force?: boolean } = {},
): Promise<void> {
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      console.warn(
        '[kodax-user-config] SDK load failed in registerKodaxCustomProviders:',
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }

  let rawProviders: SdkLoadConfigReturn['customProviders'];
  try {
    const raw = activeImpl.loadConfig();
    rawProviders = raw.customProviders;
  } catch (err) {
    console.warn(
      '[kodax-user-config] SDK loadConfig threw in registerCustomProviders:',
      err instanceof Error ? err.message : err,
    );
  }

  const mergedByName = new Map<string, SdkCustomProviderConfig>();
  for (const provider of normalizeKodaxConfigCustomProviders(rawProviders)) {
    mergedByName.set(provider.id, spaceCustomProviderToSdk(provider));
  }
  for (const provider of spaceCustomProviders) {
    const normalized = normalizeSpaceCustomProviderForSdk(provider);
    if (normalized) mergedByName.set(provider.id, normalized);
  }

  const customProviders = [...mergedByName.values()];
  if (customProviders.length === 0 && options.force !== true) return;

  try {
    activeImpl.registerCustomProviders({ customProviders });
    console.info(
      `[kodax-user-config] registered ${customProviders.length} custom provider(s) from KodaX config + Space store`,
    );
  } catch (err) {
    console.warn(
      '[kodax-user-config] registerConfiguredCustomProviders threw:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ---- helpers ----

/** SDK 可能返回 string 标记的 reasoningMode；mapped 到 Space 的 union；其它值丢弃。*/
function normalizeReasoningMode(v: unknown): KodaxUserDefaults['reasoningMode'] {
  if (typeof v !== 'string') return undefined;
  return isSpaceReasoningMode(v) ? v : undefined;
}

/**
 * KodaX permissionMode (string) → Space PermissionMode union。
 *
 * KodaX 0.7.x 合法值：'plan' | 'default' | 'accept-edits' | 'bypass-permissions'
 * Space 合法值：     'plan' | 'accept-edits' | 'auto'
 *
 * 1:1 直接映射的只有 'plan' / 'accept-edits'。'default' / 'bypass-permissions' 没有
 * 直接对应——Space 用 'auto' + auto-rules.jsonc 模拟 bypass，'default' 是 KodaX 早期
 * 模式 Space 不复刻。返回 undefined 让 renderer 走 Space schema default ('accept-edits')。
 */
function normalizePermissionMode(v: unknown): KodaxMappablePermissionMode | undefined {
  if (typeof v !== 'string') return undefined;
  if (v === 'plan' || v === 'accept-edits') return v;
  return undefined;
}

function normalizeKodaxConfigCustomProviders(
  providers: SdkLoadConfigReturn['customProviders'],
): readonly KodaxConfigCustomProvider[] {
  if (!Array.isArray(providers)) return [];
  const list: KodaxConfigCustomProvider[] = [];
  for (const provider of providers) {
    const normalized = normalizeKodaxConfigCustomProvider(provider);
    if (normalized) list.push(normalized);
  }
  return list;
}

function normalizeKodaxConfigCustomProvider(
  provider: SdkCustomProviderConfig,
): KodaxConfigCustomProvider | null {
  const raw = provider as unknown as Record<string, unknown>;
  const name = raw.name;
  const protocol = raw.protocol;
  const baseUrl = raw.baseUrl;
  const apiKeyEnv = raw.apiKeyEnv;
  const model = raw.model;
  if (
    !isNonEmptyString(name) ||
    !isSafeProviderId(name) ||
    !isSupportedCustomProtocol(protocol) ||
    !isNonEmptyString(baseUrl) ||
    !isNonEmptyString(apiKeyEnv) ||
    !isNonEmptyString(model)
  ) {
    return null;
  }

  const envErr = validateApiKeyEnv(apiKeyEnv);
  if (envErr) return null;

  const urlCheck = validateBaseUrl(baseUrl, { skipValidation: true });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) return null;

  const models = normalizeModelList(raw.models);
  const promptCacheAffinity = raw.promptCacheAffinity === true ? true : undefined;
  const reasoning = normalizeReasoningConfig(raw.reasoning);
  return {
    id: name,
    displayName: name,
    protocol,
    baseUrl: urlCheck.normalizedUrl,
    skipBaseUrlValidation: true,
    apiKeyEnv,
    defaultModel: model,
    ...(models ? { models } : {}),
    ...(promptCacheAffinity ? { promptCacheAffinity } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

/**
 * Parse a raw config `reasoning` value into Space's friendly form. Accepts the
 * canonical `'none'` or `{ efforts: string[]; default?: string }`; anything else
 * (a raw `reasoningProfile` override, deprecated fields, garbage) → undefined so
 * it is treated as unmodeled and preserved verbatim by the update merge.
 */
function normalizeReasoningConfig(raw: unknown): CustomProviderReasoning | undefined {
  if (raw === 'none') return 'none';
  if (!raw || typeof raw !== 'object') return undefined;
  const efforts = (raw as { efforts?: unknown }).efforts;
  if (!Array.isArray(efforts)) return undefined;
  const cleaned = efforts.filter((e): e is string => isNonEmptyString(e)).slice(0, 16);
  if (cleaned.length === 0) return undefined;
  const rawDefault = (raw as { default?: unknown }).default;
  const defaultEffort = isNonEmptyString(rawDefault) ? rawDefault : undefined;
  return { efforts: cleaned, ...(defaultEffort ? { default: defaultEffort } : {}) };
}

function spaceCustomProviderToSdk(provider: SpaceCustomProviderForSdk): SdkCustomProviderConfig {
  const config: Record<string, unknown> = {
    name: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv,
    model: provider.defaultModel,
  };
  if (provider.models && provider.models.length > 0) {
    config.models = [...provider.models];
  }
  if (provider.promptCacheAffinity === true) {
    config.promptCacheAffinity = true;
  }
  // Canonical SDK friendly form: reasoning: { efforts, default } | 'none'.
  if (provider.reasoning !== undefined) {
    config.reasoning =
      provider.reasoning === 'none'
        ? 'none'
        : {
            efforts: [...provider.reasoning.efforts],
            ...(provider.reasoning.default !== undefined
              ? { default: provider.reasoning.default }
              : {}),
          };
  }
  return config as unknown as SdkCustomProviderConfig;
}

function normalizeSpaceCustomProviderForSdk(
  provider: SpaceCustomProviderForSdk,
): SdkCustomProviderConfig | null {
  const envErr = validateApiKeyEnv(provider.apiKeyEnv);
  if (envErr) return null;
  const urlCheck = validateBaseUrl(provider.baseUrl, {
    skipValidation: provider.skipBaseUrlValidation === true,
  });
  if (!urlCheck.ok || !urlCheck.normalizedUrl) return null;
  return spaceCustomProviderToSdk({
    ...provider,
    baseUrl: urlCheck.normalizedUrl,
  });
}

async function loadWritableKodaxConfig(): Promise<SdkLoadConfigReturn> {
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    await loadSdkRootModule();
  }
  return activeImpl.loadConfig();
}

function saveWritableKodaxConfig(config: SdkLoadConfigReturn): void {
  if (!activeImpl.saveConfig) {
    throw new Error('KodaX config writer unavailable');
  }
  activeImpl.saveConfig(config);
  invalidateUserDefaultsCache();
}

const MAX_CONFIG_BYTES = 1_048_576;
const MODELED_COMPACTION_KEYS = new Set([
  'enabled',
  'triggerPercent',
  'triggerTokens',
  'contextWindow',
]);

function getKodaxConfigPath(): string {
  return path.join(getKodaxRuntimeDir(), 'config.json');
}

async function loadRawConfigForOverview(
  configPath: string,
  errors: KodaxConfigOverviewT['errors'],
): Promise<SdkWritableConfig> {
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      errors.push({
        path: configPath,
        error: `SDK load failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return {};
    }
  }
  try {
    return activeImpl.loadConfig() as SdkWritableConfig;
  } catch (err) {
    errors.push({
      path: configPath,
      error: `loadConfig failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {};
  }
}

async function buildKodaxConfigOverview(
  raw: SdkWritableConfig,
  projectRoot: string | undefined,
  errors: KodaxConfigOverviewT['errors'],
): Promise<KodaxConfigOverviewT> {
  const kodaxDir = getKodaxRuntimeDir();
  const configPath = getKodaxConfigPath();
  const configExists = await pathIsFile(configPath);
  const projectSummary = await readProjectConfigSummary(projectRoot, configPath, errors);

  return {
    configPath,
    configExists,
    compaction: normalizeCompactionSettings(raw.compaction),
    mcp: {
      globalPath: configPath,
      ...(projectSummary.projectPath ? { projectPath: projectSummary.projectPath } : {}),
      globalConfigExists: configExists,
      ...(projectSummary.projectConfigExists !== undefined
        ? { projectConfigExists: projectSummary.projectConfigExists }
        : {}),
      globalServers: countMcpServers(raw.mcpServers),
      projectServers: projectSummary.projectServers,
    },
    skills: {
      userSkillsDir: path.join(kodaxDir, 'skills'),
      ...(projectSummary.projectRoot
        ? { projectSkillsDir: path.join(projectSummary.projectRoot, '.kodax', 'skills') }
        : {}),
    },
    errors: errors.slice(0, 8),
  };
}

function normalizeCompactionSettings(raw: unknown): KodaxCompactionSettingsT {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: true };
  const record = raw as Record<string, unknown>;
  const out: KodaxCompactionSettingsT = { enabled: true };
  if (typeof record.triggerPercent === 'number' && Number.isSafeInteger(record.triggerPercent)) {
    out.triggerPercent = Math.min(
      KODAX_COMPACTION_TRIGGER_PERCENT_MAX,
      Math.max(KODAX_COMPACTION_TRIGGER_PERCENT_MIN, record.triggerPercent),
    );
  }
  if (
    typeof record.contextWindow === 'number' &&
    Number.isInteger(record.contextWindow) &&
    record.contextWindow >= 1024 &&
    record.contextWindow <= 10_000_000
  ) {
    out.contextWindow = record.contextWindow;
  }
  if (
    typeof record.triggerTokens === 'number' &&
    Number.isInteger(record.triggerTokens) &&
    record.triggerTokens >= 0 &&
    record.triggerTokens <= 10_000_000
  ) {
    out.triggerTokens = record.triggerTokens;
  }
  return out;
}

function mergeCompactionSettings(
  currentRaw: unknown,
  modeled: KodaxCompactionSettingsT,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (currentRaw && typeof currentRaw === 'object' && !Array.isArray(currentRaw)) {
    for (const [key, value] of Object.entries(currentRaw as Record<string, unknown>)) {
      if (!MODELED_COMPACTION_KEYS.has(key)) out[key] = value;
    }
  }
  Object.assign(out, modeled);
  return Object.keys(out).length > 0 ? out : undefined;
}

async function pathIsFile(filePath: string): Promise<boolean> {
  return fsp
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false);
}

function countMcpServers(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  return Math.min(128, Object.keys(raw as Record<string, unknown>).length);
}

async function readProjectConfigSummary(
  projectRoot: string | undefined,
  globalConfigPath: string,
  errors: KodaxConfigOverviewT['errors'],
): Promise<{
  projectRoot?: string;
  projectPath?: string;
  projectConfigExists?: boolean;
  projectServers: number;
}> {
  if (!projectRoot || !path.isAbsolute(projectRoot)) return { projectServers: 0 };
  const normalizedProjectRoot = path.normalize(projectRoot);
  const projectPath = path.join(normalizedProjectRoot, '.kodax', 'config.json');
  if (path.resolve(projectPath) === path.resolve(globalConfigPath)) {
    return { projectRoot: normalizedProjectRoot, projectServers: 0 };
  }

  let stat;
  try {
    stat = await fsp.stat(projectPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        projectRoot: normalizedProjectRoot,
        projectPath,
        projectConfigExists: false,
        projectServers: 0,
      };
    }
    errors.push({
      path: projectPath,
      error: `stat failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      projectRoot: normalizedProjectRoot,
      projectPath,
      projectConfigExists: false,
      projectServers: 0,
    };
  }
  if (!stat.isFile()) {
    return {
      projectRoot: normalizedProjectRoot,
      projectPath,
      projectConfigExists: false,
      projectServers: 0,
    };
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    errors.push({ path: projectPath, error: `config file too large (${stat.size} bytes)` });
    return {
      projectRoot: normalizedProjectRoot,
      projectPath,
      projectConfigExists: true,
      projectServers: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(projectPath, 'utf8'));
  } catch (err) {
    errors.push({
      path: projectPath,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      projectRoot: normalizedProjectRoot,
      projectPath,
      projectConfigExists: true,
      projectServers: 0,
    };
  }

  const projectServers =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? countMcpServers((parsed as Record<string, unknown>).mcpServers)
      : 0;
  return {
    projectRoot: normalizedProjectRoot,
    projectPath,
    projectConfigExists: true,
    projectServers,
  };
}

/**
 * The SdkCustomProviderConfig keys that {@link customProviderUpdateToSdk} /
 * {@link spaceCustomProviderToSdk} own (i.e. driven by Space's provider form).
 * On update these are fully REPLACED by the rebuild (so clearing one — e.g. emptying
 * the model list or the reasoning declaration — actually takes effect); every other key
 * on the existing record is preserved so CLI-set fields Space does NOT model
 * (`reasoningProfile` / `supportsThinking` / custom headers / …) survive an edit.
 * Keep in sync with `spaceCustomProviderToSdk`'s output shape.
 */
const CUSTOM_PROVIDER_MODELED_KEYS: ReadonlySet<string> = new Set([
  'name',
  'protocol',
  'baseUrl',
  'apiKeyEnv',
  'model',
  'models',
  'promptCacheAffinity',
  // 'reasoning' 是 Space 表单建模并作为其权威编辑器的字段（表单会用现有值预填,见
  // CustomProviderForm reasoningNone/reasoningEfforts/reasoningDefault）。必须纳入 modeled
  // keys,否则 merge 永远保留旧值 → 用户清空 reasoning 无效（C3 bug）。注意：SDK 侧的
  // reasoningProfile / supportsThinking 是 **另外的** key,不由表单建模,仍走 preserved 保留。
  'reasoning',
]);

function customProviderUpdateToSdk(
  providerId: string,
  update: KodaxConfigCustomProviderUpdate,
): SdkCustomProviderConfig {
  return spaceCustomProviderToSdk({
    id: providerId,
    protocol: update.protocol,
    baseUrl: update.baseUrl,
    skipBaseUrlValidation: update.skipBaseUrlValidation,
    apiKeyEnv: update.apiKeyEnv,
    defaultModel: update.defaultModel,
    models: update.models,
    promptCacheAffinity: update.promptCacheAffinity,
    ...(update.reasoning !== undefined ? { reasoning: update.reasoning } : {}),
  });
}

function providerName(provider: SdkCustomProviderConfig): string | undefined {
  const name = (provider as unknown as { readonly name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}
function normalizeModelList(models: unknown): readonly string[] | undefined {
  if (!Array.isArray(models)) return undefined;
  const seen = new Set<string>();
  for (const item of models) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { id?: unknown }).id
          : undefined;
    if (isNonEmptyString(id)) seen.add(id);
  }
  return seen.size > 0 ? [...seen] : undefined;
}

function isSupportedCustomProtocol(v: unknown): v is 'anthropic' | 'openai' {
  return v === 'anthropic' || v === 'openai';
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isSafeProviderId(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v);
}

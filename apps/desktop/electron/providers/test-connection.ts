// Test connection — FEATURE_004，FEATURE_216 (SDK 0.7.45) 起改走 SDK。
//
// 验证 API key 对 provider 是否有效。**走 SDK Provider `verifyCredential()`**，不再手写
// HTTP probe —— 与实际对话/coding 调用同源（SDK 按 provider-capabilities.json 的
// verifyStrategy 自动选 count-tokens / models-list / minimal-message），消除「测连接 vs
// 实际调用」双实现漂移：SDK 新增 provider 时 Space 零改动自动跟上。
//
// 成本：多数 provider 走 count-tokens / models-list = 0 token；zhipu / mimo / mimo-coding
// 走 minimal-message ≈ 6-7 token（SDK 侧 count-tokens 对它们返 404 才退化到此）。
//
// 凭证：Space keychain 和启动前真实 env 都使用 SDK 的 exact-provider credential scope。
// 不能调用顶层 verifyProviderCredential：它会在创建 Provider 前先检查 process.env，看不到只
// 存在于 scope 的 keychain 凭据，也可能读到并发注入的另一个 Provider 凭据。
//
// 错误脱敏：本模块只把凭据交给 SDK exact scope，不记录、拼接或返回 secret。

import type { BuiltinProvider } from './catalog.js';
import type { CustomProvider } from './config.js';
import { validateBaseUrl } from './url-guard.js';
import {
  MissingExactProviderCredentialError,
  runWithExactProviderCredential,
} from './credential-scope.js';

export interface CustomProviderProbe {
  readonly id: string;
  readonly protocol: CustomProvider['protocol'];
  readonly baseUrl: string;
  readonly skipBaseUrlValidation?: boolean;
  readonly apiKeyEnv: string;
  readonly defaultModel: string;
  readonly models?: readonly string[];
}

type Probe = BuiltinProvider | CustomProviderProbe;

export interface TestResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

interface VerifyOpts {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

// SDK /llm 走真实 d.ts（ambient kodax-sdk-types.d.ts 不声明 /llm，真实 sdk-llm.d.ts 提供
// getProvider / createCustomProvider / KodaXVerifyCredentialResult）。
type SdkLlm = typeof import('@kodax-ai/kodax/llm');
/** 测连接只用到 SDK 的 Provider factories。*/
export type TestProviderModule = Pick<SdkLlm, 'getProvider' | 'createCustomProvider'>;

type VerifyResult = Awaited<ReturnType<ReturnType<SdkLlm['getProvider']>['verifyCredential']>>;

const DEFAULT_TIMEOUT_MS = 8000;

// 模块级 lazy-import cache —— 仿 real-session.ts loadSdkLlm。
// **dynamic import**：SDK subpath 只声明 ESM "import" 条件，CJS-built main 静态 require 会撞
// ERR_PACKAGE_PATH_NOT_EXPORTED。失败的 promise 留 cache 返 null，不反复重试。
let sdkLlmCache: Promise<TestProviderModule | null> | null = null;
function loadSdkLlm(): Promise<TestProviderModule | null> {
  if (sdkLlmCache === null) {
    sdkLlmCache = import('@kodax-ai/kodax/llm').catch((err) => {
      console.warn(
        `[test-connection] failed to load @kodax-ai/kodax/llm: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    });
  }
  return sdkLlmCache;
}

function mapSdkError(error: VerifyResult['error']): string {
  switch (error) {
    case 'unauthorized':
      return 'unauthorized (check API key)';
    case 'network':
      return 'network error';
    case 'timeout':
      return 'timeout';
    case 'unsupported':
      return 'provider does not support connection test';
    case 'unconfigured':
      return 'no API key configured';
    case 'server_error':
      return 'server error';
    case 'rate_limited':
      return 'rate limited (try again later)';
    default:
      return 'unknown error';
  }
}

function toResult(r: VerifyResult): TestResult {
  if (r.ok) return { ok: true, latencyMs: r.durationMs };
  return { ok: false, latencyMs: r.durationMs, error: mapSdkError(r.error) };
}

async function runCredentialVerification(
  provider: string,
  operation: () => Promise<TestResult>,
): Promise<TestResult> {
  try {
    return await runWithExactProviderCredential(provider, operation);
  } catch (error) {
    if (error instanceof MissingExactProviderCredentialError) {
      return { ok: false, error: 'no API key configured' };
    }
    throw error;
  }
}

/**
 * 用 exact Space credential 或启动前 env 探测一次 provider，结果用于 UI 绿/红状态。
 *
 * @param deps  测试注入：`undefined` = 真实 lazy import；`null` = 模拟 SDK 不可用降级。
 *
 * builtin → `getProvider(id).verifyCredential()`。
 * custom（Space `custom_*` 不在 SDK runtime registry）→ `createCustomProvider(config).verifyCredential()`。
 */
export async function testProvider(
  provider: Probe,
  opts?: VerifyOpts,
  deps?: TestProviderModule | null,
): Promise<TestResult> {
  const sdk = deps === undefined ? await loadSdkLlm() : deps;
  if (sdk === null) {
    return { ok: false, error: 'SDK unavailable (try restarting)' };
  }

  const verifyOpts: VerifyOpts = {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts?.signal,
  };

  // custom provider：BuiltinProvider 无 baseUrl，用它区分。
  if ('baseUrl' in provider) {
    // SSRF defense-in-depth：custom-providers.json 可能被外部进程篡改成内网 / metadata URL
    //（如 http://169.254.169.254）。addCustom 时已 validateBaseUrl，这里运行前再 double-check——
    // baseUrl 会带着 env 里的 API key 真发请求，篡改后果是 key 泄露给攻击者端点。
    const urlCheck = validateBaseUrl(provider.baseUrl, {
      skipValidation: provider.skipBaseUrlValidation === true,
    });
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { ok: false, error: `invalid baseUrl: ${urlCheck.error ?? 'validation failed'}` };
    }
    let instance: ReturnType<TestProviderModule['createCustomProvider']>;
    try {
      instance = sdk.createCustomProvider({
        name: provider.id,
        protocol: provider.protocol,
        baseUrl: urlCheck.normalizedUrl,
        apiKeyEnv: provider.apiKeyEnv,
        model: provider.defaultModel,
        models: provider.models ? [...provider.models] : undefined,
      });
    } catch {
      // 不回传 err.message —— SDK 的 validateCustomProviderConfig 错误可能含 apiKeyEnv 名等配置字段。
      return { ok: false, error: 'invalid custom provider config' };
    }
    return deps === undefined
      ? runCredentialVerification(provider.id, async () =>
          toResult(await instance.verifyCredential(verifyOpts)),
        )
      : toResult(await instance.verifyCredential(verifyOpts));
  }

  if (typeof sdk.getProvider !== 'function') {
    return {
      ok: false,
      error: 'Provider connection test requires SDK with getProvider(). Upgrade @kodax-ai/kodax.',
    };
  }
  return deps === undefined
    ? runCredentialVerification(provider.id, async () =>
        toResult(await sdk.getProvider(provider.id).verifyCredential(verifyOpts)),
      )
    : toResult(await sdk.getProvider(provider.id).verifyCredential(verifyOpts));
}

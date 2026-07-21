// Built-in provider catalog —— **薄适配层**
//
// 数据来源拆分（单一事实源原则）：
//   • SDK 单一来源：直接读 `@kodax-ai/kodax/dist/provider-capabilities.json`
//     —— KodaX 在 build 时把 packages/llm 的 capability JSON copy 到顶层 dist。
//     拉 apiKeyEnv / defaultModel / models[]，不再手 copy 一份 snapshot 到 Space 里。
//     之前 (v0.7.40 snapshot) 手 copy 导致 KodaX 改了 env 名 Space 不知道，必须人工 sync；
//     现在 KodaX 改 → Space 自动跟上。
//   • Space override (本文件 SPACE_OVERRIDES)：displayName / protocol —— 纯 UI 元数据
//     SDK 不关心这些（KodaX 用 `capabilityProfile` 表达更丰富的能力）。protocol 现仅用于
//     UI 显示与 custom provider 表单；测连接已改走 SDK verifyProviderCredential（FEATURE_216），
//     不再需要 Space 手维护 testEndpoint。
//
// 为什么不 dynamic-import @kodax-ai/kodax 读 KODAX_PROVIDER_SNAPSHOTS：
//   1. JSON 直读是 SYNC 的，catalog 可以保持模块顶层 const 不需要 init step。
//   2. 加载整个 SDK runtime 仅为读 13 条 provider 数据是巨大浪费 (transitive deps 几十个)。
//   3. 直接读取发布包内的能力 JSON，避免为了静态 catalog 初始化完整 SDK 及其无关依赖。
//
// 与 SDK 的 schema 对齐：JSON 的 `models[]` 是 `{ id, displayName, ... }` 对象数组，
// 这里映射成 string[] (只取 id) 给 UI 用。

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ProviderProtocol } from '@kodax-space/space-ipc-schema';

export interface BuiltinProvider {
  readonly id: string;
  readonly displayName: string;
  readonly apiKeyEnv: string;
  readonly protocol: ProviderProtocol;
  readonly defaultModel: string;
  readonly models?: readonly string[];
}

/**
 * Space-only override：SDK 不提供的 UI / 测连接元数据。
 * id 必须与 SDK provider-capabilities.json key 一致。
 *
 * SDK 增加新 provider 时本表没条目 → 自动用兜底 displayName=id + protocol='openai'，
 * 并打 warn 提醒补 override（让 UI 显示更友好）。
 */
interface SpaceOverride {
  readonly displayName: string;
  readonly protocol: ProviderProtocol;
  /**
   * JSON 没 model 字段时的兜底（CLI bridge provider 用 —— KodaX SDK runtime 调
   * `getCodexCliDefaultModel()` 等动态填，JSON 里是空的）。
   */
  readonly defaultModelFallback?: string;
  /**
   * **完全 fallback** —— provider-capabilities.json 缺失 / 损坏时也能撑起 catalog。
   * 与 KodaX SDK fa7213f 的 env 名一致 (sync 自上游)。生产路径不依赖此字段，
   * 只作 disaster recovery。
   */
  readonly fallbackApiKeyEnv: string;
  readonly fallbackDefaultModel: string;
}

const SPACE_OVERRIDES: Record<string, SpaceOverride> = {
  anthropic: {
    displayName: 'Anthropic',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'ANTHROPIC_API_KEY',
    fallbackDefaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    displayName: 'OpenAI',
    protocol: 'openai',
    fallbackApiKeyEnv: 'OPENAI_API_KEY',
    fallbackDefaultModel: 'gpt-5.3-codex',
  },
  deepseek: {
    displayName: 'DeepSeek',
    protocol: 'openai',
    fallbackApiKeyEnv: 'DEEPSEEK_API_KEY',
    fallbackDefaultModel: 'deepseek-v4-flash',
  },
  kimi: {
    displayName: 'Kimi (Moonshot)',
    protocol: 'openai',
    fallbackApiKeyEnv: 'KIMI_API_KEY',
    fallbackDefaultModel: 'kimi-k2.7-code',
  },
  'kimi-code': {
    displayName: 'Kimi for Coding',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'KIMI_CODE_API_KEY',
    fallbackDefaultModel: 'kimi-for-coding',
  },
  qwen: {
    displayName: 'Qwen (Alibaba)',
    protocol: 'openai',
    fallbackApiKeyEnv: 'QWEN_API_KEY',
    fallbackDefaultModel: 'qwen3.5-plus',
  },
  'qwen-token-plan': {
    displayName: 'Qwen Token Plan',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'QWEN_TOKEN_API_KEY',
    fallbackDefaultModel: 'qwen3.8-max-preview',
  },
  zhipu: {
    displayName: 'Zhipu (BigModel)',
    protocol: 'openai',
    fallbackApiKeyEnv: 'ZHIPU_API_KEY',
    fallbackDefaultModel: 'glm-5',
  },
  'zhipu-coding': {
    displayName: 'Zhipu Coding Plan',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'ZHIPU_CODING_API_KEY',
    fallbackDefaultModel: 'glm-5.2',
  },
  // Z.ai Coding Plan（SDK 0.7.58 新增，与 zhipu-coding 并列的 GLM-5.2 coding-plan 入口）。
  // 继承 KodaXAnthropicCompatProvider → protocol=anthropic（baseUrl https://api.z.ai/api/anthropic）；
  // 缺此 override 会退化成 displayName='zai-coding' + protocol='openai'（错）。
  'zai-coding': {
    displayName: 'Z.ai Coding Plan',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'ZAI_CODING_API_KEY',
    fallbackDefaultModel: 'glm-5.2',
  },
  'minimax-coding': {
    displayName: 'MiniMax Coding',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'MINIMAX_CODING_API_KEY',
    fallbackDefaultModel: 'MiniMax-M3',
  },
  'mimo-coding': {
    displayName: 'MiMo Coding (Xiaomi)',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'MIMO_CODING_API_KEY',
    fallbackDefaultModel: 'mimo-v2.5-pro',
  },
  // 小米 MiMo 直连版（SDK 2026-05-25 新增，与订阅版 mimo-coding 并列）。
  // mimo 继承 KodaXAnthropicCompatProvider → protocol=anthropic（不是兜底的 openai）。
  mimo: {
    displayName: 'MiMo (Xiaomi)',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'MIMO_API_KEY',
    fallbackDefaultModel: 'mimo-v2.5-pro',
  },
  'ark-coding': {
    displayName: 'Volcengine Ark Coding',
    protocol: 'anthropic',
    fallbackApiKeyEnv: 'ARK_CODING_API_KEY',
    fallbackDefaultModel: 'glm-5.1',
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    protocol: 'gemini-cli',
    // CLI bridge — no HTTP probe applicable；defaultModel 由本地 gemini CLI 自报
    defaultModelFallback: 'gemini-3.0-pro',
    fallbackApiKeyEnv: 'GEMINI_API_KEY',
    fallbackDefaultModel: 'gemini-3.0-pro',
  },
  'codex-cli': {
    displayName: 'Codex CLI (OpenAI)',
    protocol: 'codex-cli',
    // CLI bridge — no HTTP probe applicable；defaultModel 由本地 codex CLI 自报
    defaultModelFallback: 'gpt-5.3-codex',
    fallbackApiKeyEnv: 'OPENAI_API_KEY',
    fallbackDefaultModel: 'gpt-5.3-codex',
  },
};

// ---- 读 SDK JSON 单一事实源 ----

// JSON 形态：
//   {
//     version: 1,
//     updatedAt: 'YYYY-MM-DD',
//     providers: {
//       [id: string]: {
//         apiKeyEnv: string,
//         model: string,
//         models?: Array<{ id: string, displayName?: string, ... }>,
//         ...
//       }
//     }
//   }
interface CapabilityJsonEntry {
  readonly apiKeyEnv: string;
  /** CLI bridge provider 没此字段；其他都有。*/
  readonly model?: string;
  readonly models?: ReadonlyArray<{ readonly id: string }>;
}
interface CapabilityJson {
  readonly version: number;
  readonly providers: Readonly<Record<string, CapabilityJsonEntry>>;
}

function resolveCapabilityJsonPath(): string {
  // require.resolve('@kodax-ai/kodax/package.json') 在 exports map 里显式列了，
  // 永远可解析；从那里推 sibling dist/provider-capabilities.json 路径稳定。
  // ESM 没 require —— createRequire(import.meta.url) 通用兼容，main build (CJS) 也吃得下。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  const pkgPath = req.resolve('@kodax-ai/kodax/package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'provider-capabilities.json');
}

function loadProvidersFromJson(): readonly BuiltinProvider[] {
  const jsonPath = resolveCapabilityJsonPath();
  const raw = readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as CapabilityJson;
  if (parsed.version !== 1) {
    // 不抛 —— 仍尝试按 v1 shape 解析。若 KodaX 真的 bump 到 v2 且字段不兼容，
    // 这里会在下面 forEach 里因字段缺失抛出更具体的错误。
    console.warn(
      `[catalog] provider-capabilities.json version=${parsed.version}, expected 1 — ` +
        `Space catalog may need a sync with KodaX schema changes`,
    );
  }
  const list: BuiltinProvider[] = [];
  for (const [id, entry] of Object.entries(parsed.providers)) {
    const ov = SPACE_OVERRIDES[id];
    if (!ov) {
      console.warn(
        `[catalog] SDK provider '${id}' has no Space override; using fallback ` +
          `displayName/protocol. Add an entry to SPACE_OVERRIDES in catalog.ts.`,
      );
    }
    // entry.model 缺失时（CLI bridge）走 Space override fallback；都没有则用 id 兜底
    const defaultModel = entry.model ?? ov?.defaultModelFallback ?? id;
    // JSON 的 models[] 不含 default — 拼到开头让 UI 直接遍历就有 default 在第一位
    const variants = (entry.models ?? []).map((m) => m.id);
    const models = [defaultModel, ...variants.filter((m) => m !== defaultModel)];
    list.push({
      id,
      displayName: ov?.displayName ?? id,
      apiKeyEnv: entry.apiKeyEnv,
      protocol: ov?.protocol ?? 'openai',
      defaultModel,
      models,
    });
  }
  return list;
}

// Disaster fallback —— provider-capabilities.json 缺失/损坏时用 SPACE_OVERRIDES 构造。
// 触发场景：
//   - npm link 断了 (dist 不再 junction，被 npm install 覆盖成 0.7.42 tarball 内容
//     而 tarball 里 dist/ 不含 provider-capabilities.json) — 见 2026-06-01 主进程崩溃
//   - 用户手动删了 node_modules 但忘 reinstall
//   - KodaX upstream schema 变了我们没跟上
//
// fallback 数据来源：与 KodaX SDK 最近 sync 一致 (fa7213f sync 自上游)，
// 比真相旧一些但能让 Space 跑起来 + log 警告提示用户 reinstall / re-link。
function buildFallbackProviders(): readonly BuiltinProvider[] {
  const list: BuiltinProvider[] = [];
  for (const [id, ov] of Object.entries(SPACE_OVERRIDES)) {
    list.push({
      id,
      displayName: ov.displayName,
      apiKeyEnv: ov.fallbackApiKeyEnv,
      protocol: ov.protocol,
      defaultModel: ov.fallbackDefaultModel,
      // fallback 不提供 model variant 列表 —— UI 显示单条 default 即可
      models: [ov.fallbackDefaultModel],
    });
  }
  return list;
}

// 模块顶层一次性 load —— 优先读 SDK 真相（provider-capabilities.json）；任何错误
// (ENOENT / JSON 解析 / 字段缺失) 都退化到 fallback，不让 Space 崩。
// 启动后 catalog 数据 immutable，重新 hot-reload Space 进程才会重读 (KodaX 升 SDK 时
// 用户重启 Space 自然吃到新 catalog)。
function loadProvidersWithFallback(): readonly BuiltinProvider[] {
  try {
    return loadProvidersFromJson();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[catalog] failed to load provider-capabilities.json — using built-in fallback. ` +
        `Run \`npm install --force\` or \`npm run link:kodax\` to restore SDK truth. ` +
        `Error: ${message}`,
    );
    return buildFallbackProviders();
  }
}

export const BUILTIN_PROVIDERS: readonly BuiltinProvider[] = loadProvidersWithFallback();

export function getBuiltin(id: string): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

export function isBuiltinId(id: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.id === id);
}

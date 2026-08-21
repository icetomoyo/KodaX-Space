// Space skill registry wrapper — FEATURE_035.
//
// 薄壳：包 KodaX SDK 的 SkillRegistry（@kodax-ai/kodax/skills），加 per-projectRoot
// 缓存 + TTL，避免每次 skill.discover IPC 都做一遍 ~/.kodax/skills + <proj>/.kodax/skills
// 全盘扫描（小项目 5-20 ms，大 monorepo 可能上百 ms）。
//
// 缓存策略：
//   - key = absolute projectRoot
//   - value = { registry, expiresAt }
//   - TTL = 30s（小到能反映 user 新装 skill；够大避免连按 popover 反复扫盘）
//   - 显式 invalidate()：F035 之后会接 file-watch；alpha.1 走简单 TTL 即可
//
// 安全：projectRoot 必须 absolute 且已经过 host.validateProjectRoot 校验，wrapper 不重复
// 校验（caller responsibility）。SDK 内部对每个 skill 目录读 SKILL.md 失败都 swallow，
// 不会向 Space main 抛出。
//
// **静态 import 改 dynamic**：SDK subpath exports 只有 "import" 条件；CJS-built main 静态
// require 会撞 ERR_PACKAGE_PATH_NOT_EXPORTED。lazy dynamic import + cache 是 SDK module
// 加载的统一模式（见 mcp/config-reader.ts / user-config.ts / agents-md-loader.ts）。
// shape probe 改为 export async function，main.ts boot 时调一次。

import path from 'node:path';
import { isSpaceBuiltinSkillPath } from './space-builtins.js';

// `import type`：仅 compile-time，runtime 不生 require —— 配合 dynamic import 命中 "import" 条件。
import type {
  SkillRegistry as SkillRegistryT,
  SkillMetadata as SdkSkillMetadata,
} from '@kodax-ai/kodax/skills';
export type SkillMetadata = SdkSkillMetadata;
type SdkSkillsModule = typeof import('@kodax-ai/kodax/skills');

let sdkModuleCache: SdkSkillsModule | null = null;
async function loadSdkSkills(): Promise<SdkSkillsModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax/skills');
  }
  return sdkModuleCache;
}

const TTL_MS = 30_000;

/**
 * 启动期一次性 probe — 保证 ambient 声明的 SkillRegistry 方法在实际 SDK 上确实存在
 * （SDK 升版本删/改方法时 fail-fast，而不是用户调时才"not a function"）。
 * main.ts 启动期调一次；reviewer F035 HIGH-3。
 */
export async function probeSkillRegistry(): Promise<void> {
  const sdk = await loadSdkSkills();
  const probe = new sdk.SkillRegistry('/tmp');
  for (const m of [
    'discover',
    'list',
    'listUserInvocable',
    'loadFull',
    'invoke',
    'reload',
  ] as const) {
    const fn = (probe as unknown as Record<string, unknown>)[m];
    if (typeof fn !== 'function') {
      throw new Error(
        `[skill-registry] SDK shape mismatch: SkillRegistry.${m} is ${typeof fn}; ` +
          `expected function. Update apps/desktop/electron/kodax/kodax-sdk-types.d.ts`,
      );
    }
  }
}

interface CacheEntry {
  registry: SkillRegistryT;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * 取（或生成）给定 projectRoot 的 SkillRegistry，已经 discover() 完毕。
 * 命中缓存且未过期 → 直接返回；否则 new 一个并触发 discover()。
 */
export async function getSkillRegistry(projectRoot: string): Promise<SkillRegistryT> {
  if (!path.isAbsolute(projectRoot)) {
    throw new Error(`[skill-registry] projectRoot must be absolute: ${projectRoot}`);
  }
  const normalized = path.normalize(projectRoot);
  const now = Date.now();
  const hit = cache.get(normalized);
  if (hit && hit.expiresAt > now) {
    return hit.registry;
  }
  const sdk = await loadSdkSkills();
  const registry = new sdk.SkillRegistry(normalized);
  await registry.discover();
  cache.set(normalized, { registry, expiresAt: now + TTL_MS });
  return registry;
}

/** 显式失效（F037 future file-watch 或测试用）。 */
export function invalidateSkillCache(projectRoot?: string): void {
  if (projectRoot === undefined) {
    cache.clear();
    return;
  }
  cache.delete(path.normalize(projectRoot));
}

/**
 * 把 SDK SkillMetadata 映射到 IPC schema SkillMeta 形态。
 * KodaX 0.7.94 makes every enabled Skill explicitly invocable. Legacy
 * `userInvocable` and model-only `disableModelInvocation` flags do not affect
 * the popover; SDK model discovery enforces the latter separately.
 */
export function toSkillMeta(m: SkillMetadata): {
  name: string;
  description: string;
  argumentHint?: string;
  source: SkillMetadata['source'];
  path: string;
} {
  // Clamp to the IPC schema caps. Real skills routinely have long trigger
  // descriptions (>512), which would otherwise fail skillMetaSchema and — because
  // z.array rejects on ANY element — blow up the WHOLE skill.discover output
  // (OUTPUT_INVALID → empty picker + skills missing from slash). 用户复报 2026-06-15。
  const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);
  return {
    name: clamp(m.name, 64),
    description: clamp(m.description ?? '', 512),
    argumentHint: m.argumentHint ? clamp(m.argumentHint, 128) : undefined,
    source: isSpaceBuiltinSkillPath(m.path) ? 'builtin' : m.source,
    path: clamp(m.path, 4096),
  };
}

export type SkillMeta = ReturnType<typeof toSkillMeta>;

/**
 * Merge independently discovered skill catalogs without duplicate slash rows.
 *
 * `preferred` is intentionally emitted first and wins by name. The daemon
 * catalog is authoritative for runtime-owned skills, while Space-owned
 * builtins are preferred so the item shown by the Composer resolves through
 * the same local registry used by `skill.invoke`.
 */
export function mergeSkillMetas(
  preferred: readonly SkillMeta[],
  fallback: readonly SkillMeta[],
  limit = 256,
): SkillMeta[] {
  if (limit <= 0) return [];
  const names = new Set<string>();
  const merged: SkillMeta[] = [];
  for (const catalog of [preferred, fallback]) {
    for (const skill of catalog) {
      if (names.has(skill.name)) continue;
      names.add(skill.name);
      merged.push(skill);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

/**
 * 预扫 skill content 是否含 `` !`...` `` dynamic-context 模板（SDK VariableResolver
 * 会用 execSync 跑这些命令）。alpha.1 阶段一律拒绝——SDK execSync 完全绕过 F029/F030
 * permission broker，等同于"任意 SKILL.md 都能拿主进程 fs/network 权限"，违反 KodaX Space
 * 的同意模型（reviewer F035 CRITICAL-2）。
 *
 * 后续若想支持：要么在 SDK 加禁用开关、要么在调用前把命令转成 KodaX tool call 走 broker。
 *
 * @returns 含 unsafe token 时返回带说明的拒绝文案；安全则返回 null。
 */
export async function refuseIfUnsafeContent(
  registry: SkillRegistryT,
  skillName: string,
): Promise<string | null> {
  let full;
  try {
    full = await registry.loadFull(skillName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `failed to load skill '${skillName}': ${msg}`;
  }
  // 同时扫 content + rawContent —— SDK 解析后两者通常相同，但 alpha.1 防御性都查
  const hay = `${full.content}\n${full.rawContent}`;
  // `!` + backtick + 任何内容 + closing backtick（最短匹配以兼容代码块包内的 ! 出现）
  if (/!`[^`]+`/.test(hay)) {
    return (
      `skill '${skillName}' contains dynamic-context shell tokens (\`!\`...\`` +
      `); blocked by KodaX Space safety policy. ` +
      `These tokens would execute shell commands outside the permission broker.`
    );
  }
  return null;
}

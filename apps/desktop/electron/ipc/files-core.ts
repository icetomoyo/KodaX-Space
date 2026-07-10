// Pure helpers for files IPC — no electron dependency, fully unit-testable.
//
// 拆出来的动机：files.ts 注册 ipcMain.handle，不能在 node:test 里直接跑
// （Electron runtime 缺位）；把 path-traversal + walkTree + binary detect
// 等纯逻辑抽到这里，让 files.test.ts 直接拿绝对路径来跑。

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { validateProjectRoot } from './validate.js';
import { validateOfficePreviewBytes } from '../artifact/office-zip-guard.js';
import { MAX_FILE_BYTES, MAX_TREE_NODES, type FileNodeT } from '@kodax-space/space-ipc-schema';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.vscode',
  '.idea',
  'coverage',
  '.DS_Store',
]);

/** child 是否在 parent 子树内（含 child === parent）。Windows 上 path.relative 大小写敏感性
 * 与 OS 一致——不需要手动 lowercase。
 */
export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** OS-native path → posix-style 相对 root。Windows `C:\proj\src\a.ts` + `C:\proj` → `src/a.ts`。*/
export function toPosixRelative(absolute: string, root: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join('/');
}

/**
 * 解析 relativePath 到 projectRoot 子树内绝对路径；走 path.resolve + realpath + prefix 三重检查。
 *
 * 入参里 projectRoot 假定已是 OS-absolute（caller 应当先 validateProjectRoot）。函数内仍会
 * realpath 一次 root 本身——抓"projectRoot 自身是 symlink 指向其他位置"的情况。
 *
 * @throws Error 若 target 在 root 外（含 symlink 逃逸）
 */
export async function resolveInsideProject(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  const validatedRoot = validateProjectRoot(projectRoot);
  const realRoot = await fs.realpath(validatedRoot);

  const trimmed = relativePath.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  const target = path.resolve(realRoot, trimmed);

  if (!isPathInside(target, realRoot)) {
    throw new Error(`path escapes projectRoot: ${truncate(relativePath)}`);
  }

  let realTarget = target;
  try {
    realTarget = await fs.realpath(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return target;
    }
    throw err;
  }
  if (!isPathInside(realTarget, realRoot)) {
    throw new Error(`path escapes projectRoot via symlink: ${truncate(relativePath)}`);
  }
  return realTarget;
}

/** 递归遍历 dir 拿子节点列表，dir 排在 file 前面、同类按 name 排序。
 * counter 跨递归传一份，到 MAX_TREE_NODES 立即停。
 */
export async function walkTree(
  absRoot: string,
  absDir: string,
  depth: number,
  counter: { count: number },
): Promise<FileNodeT[]> {
  if (depth <= 0) return [];
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const out: FileNodeT[] = [];
  for (const ent of entries) {
    if (counter.count >= MAX_TREE_NODES) break;
    if (SKIP_DIRS.has(ent.name)) continue;

    const absChild = path.join(absDir, ent.name);
    const rel = toPosixRelative(absChild, absRoot);
    counter.count++;

    if (ent.isDirectory()) {
      const node: FileNodeT = { name: ent.name, path: rel, kind: 'dir' };
      if (depth > 1) {
        const children = await walkTree(absRoot, absChild, depth - 1, counter);
        if (children.length > 0) node.children = children;
      }
      out.push(node);
    } else if (ent.isFile()) {
      let size: number | undefined;
      try {
        const st = await fs.stat(absChild);
        size = st.size;
      } catch {
        // permission / race：跳过 size 字段
      }
      out.push({ name: ent.name, path: rel, kind: 'file', size });
    }
  }
  return out;
}

export function looksBinary(buf: Buffer): boolean {
  const slice = buf.length > 1024 ? buf.subarray(0, 1024) : buf;
  for (const byte of slice) {
    if (byte === 0) return true;
  }
  return false;
}

export interface ReadFileResult {
  content: string;
  encoding: 'utf-8';
  size: number;
  isBinary: boolean;
  truncated: boolean;
}

/** 读单个文件，应用 5 MB 上限 + binary 检测。caller 已保证 absPath 在 projectRoot 内。*/
export async function readFileWithGuards(absPath: string): Promise<ReadFileResult> {
  const st = await fs.stat(absPath);
  if (!st.isFile()) {
    throw new Error('not a regular file');
  }
  if (st.size > MAX_FILE_BYTES) {
    return { content: '', encoding: 'utf-8', size: st.size, isBinary: false, truncated: true };
  }
  const buf = await fs.readFile(absPath);
  if (looksBinary(buf)) {
    return { content: '', encoding: 'utf-8', size: st.size, isBinary: true, truncated: false };
  }
  return {
    content: buf.toString('utf-8'),
    encoding: 'utf-8',
    size: st.size,
    isBinary: false,
    truncated: false,
  };
}

export interface ReadFileBinaryResult {
  readonly base64: string;
  readonly size: number;
  readonly truncated: boolean;
}

/** F024: 读二进制文件，应用 maxBytes 上限（main 端兜底防 renderer 漏 cap）。
 *  caller 已保证 absPath 在 projectRoot 内。返回 base64 编码内容；超出时 truncated。 */
export async function readFileBinaryWithGuards(
  absPath: string,
  maxBytes: number,
): Promise<ReadFileBinaryResult> {
  const st = await fs.stat(absPath);
  if (!st.isFile()) {
    throw new Error('not a regular file');
  }
  if (st.size > maxBytes) {
    return { base64: '', size: st.size, truncated: true };
  }
  const buf = await fs.readFile(absPath);
  await validateOfficePreviewBytes(absPath, buf);
  return { base64: buf.toString('base64'), size: st.size, truncated: false };
}

export interface StatPathResult {
  readonly exists: boolean;
  readonly kind: 'file' | 'dir' | 'other' | null;
  readonly size?: number;
}

export async function statPath(absPath: string): Promise<StatPathResult> {
  try {
    const st = await fs.stat(absPath);
    if (st.isFile()) return { exists: true, kind: 'file', size: st.size };
    if (st.isDirectory()) return { exists: true, kind: 'dir' };
    return { exists: true, kind: 'other' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exists: false, kind: null };
    }
    throw err;
  }
}

// ---- Diff cache (in-memory LRU) ----
//
// tool_call write/edit 完成时由 adapter 调 recordDiff；前端 invoke files.diff 时取。

const diffCache = new Map<string, { before: string; after: string }>();
const DIFF_CACHE_MAX = 100;

function diffKey(projectRoot: string, relativePath: string): string {
  return `${projectRoot}::${relativePath}`;
}

export function recordDiff(
  projectRoot: string,
  relativePath: string,
  before: string,
  after: string,
): void {
  const key = diffKey(projectRoot, relativePath);
  diffCache.delete(key);
  diffCache.set(key, { before, after });
  while (diffCache.size > DIFF_CACHE_MAX) {
    const oldest = diffCache.keys().next().value;
    if (oldest === undefined) break;
    diffCache.delete(oldest);
  }
}

export function getDiff(
  projectRoot: string,
  relativePath: string,
): { before: string; after: string } | null {
  return diffCache.get(diffKey(projectRoot, relativePath)) ?? null;
}

/** Test-only：清掉所有 cache。test 之间隔离。*/
export function resetDiffCache(): void {
  diffCache.clear();
}

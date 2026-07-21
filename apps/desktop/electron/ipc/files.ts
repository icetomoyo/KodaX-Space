// File IPC handlers — FEATURE_009.
//
// 纯逻辑（path-traversal 防御、tree walk、binary detect、diff cache）抽到 files-core.ts，
// 这里只负责把 channel 接到那些纯函数上 + handler 错误归一化。

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { registerChannel } from './register.js';
import { projectStore } from '../projects/store.js';
import {
  resolveInsideProject,
  walkTree,
  readFileWithGuards,
  readFileBinaryWithGuards,
  statPath,
  getDiff,
  recordDiff as recordDiffCore,
  isPathInside,
  toPosixRelative,
  truncate,
} from './files-core.js';
import { MAX_TREE_NODES } from '@kodax-space/space-ipc-schema';
import { projectWebPreviewRegistry } from '../window/project-web-preview.js';

// 重新导出给 session adapter / mock-session 写入 diff cache 用
export const recordDiff = recordDiffCore;

export function registerFilesChannels(): void {
  // files.tree
  registerChannel('files.tree', async (input) => {
    // F005 v0.1.5：必须是 allowlist 项目（用户显式打开过）
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    const realRoot = await fs.realpath(validatedRoot);
    const startDir = input.subPath ? await resolveInsideProject(realRoot, input.subPath) : realRoot;
    const depth = input.depth ?? 1;
    const counter = { count: 0 };
    const tree = await walkTree(realRoot, startDir, depth, counter);
    return {
      tree,
      truncated: counter.count >= MAX_TREE_NODES,
    };
  });

  // files.read
  registerChannel('files.read', async (input) => {
    // F005 v0.1.5：必须是 allowlist 项目（用户显式打开过）
    await projectStore.assertAllowed(input.projectRoot);
    const absPath = await resolveInsideProject(input.projectRoot, input.path);
    try {
      return await readFileWithGuards(absPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        throw new Error(`file not found or is a directory: ${truncate(input.path)}`);
      }
      throw err;
    }
  });

  // files.readBinary (F024 富预览：PDF / docx / xlsx)
  registerChannel('files.readBinary', async (input) => {
    await projectStore.assertAllowed(input.projectRoot);
    const absPath = await resolveInsideProject(input.projectRoot, input.path);
    try {
      return await readFileBinaryWithGuards(absPath, input.maxBytes);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        throw new Error(`file not found or is a directory: ${truncate(input.path)}`);
      }
      throw err;
    }
  });

  // files.stat
  registerChannel('files.stat', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    const absPath = await resolveInsideProject(validatedRoot, input.path);
    return await statPath(absPath);
  });

  // files.webPreview - capability-scoped dynamic HTML preview, independent of Session/Artifact.
  registerChannel('files.webPreview', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    return await projectWebPreviewRegistry.create({
      projectRoot: validatedRoot,
      entryPath: input.path,
      networkAccess: input.networkAccess,
    });
  });

  // files.diff
  registerChannel('files.diff', async (input) => {
    // F005 v0.1.5：必须是 allowlist 项目（用户显式打开过）
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    const realRoot = await fs.realpath(validatedRoot);
    const trimmed = input.path.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    // 不要求文件真实存在——cache 可能保留 write 前不存在的"new file" diff
    const target = path.resolve(realRoot, trimmed);
    if (!isPathInside(target, realRoot)) {
      throw new Error(`path escapes projectRoot: ${truncate(input.path)}`);
    }
    const cached = getDiff(realRoot, toPosixRelative(target, realRoot));
    if (!cached) {
      return { before: '', after: '', available: false };
    }
    return { before: cached.before, after: cached.after, available: true };
  });
}

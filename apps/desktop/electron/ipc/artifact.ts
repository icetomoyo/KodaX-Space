// artifact.* IPC handlers — F057 数据层 (记忆 livecanvas_artifact_plan).
//
// create/list/read/delete: the LC-free artifact store (F057). create/delete push
// `artifact.changed` so the renderer refetches. The generation tool (F058) calls
// artifactStore directly (same singleton) rather than going through IPC.
// (LC sandbox `artifact.sandboxInfo` channel removed — re-added with the LiveCanvas
// interactive tier as a separate feature.)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  looksLikeInteractiveHtml,
  type ArtifactKindT,
} from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { artifactStore } from '../artifact/store.js';
import {
  extForKind,
  extForImageMime,
  parseDataUri,
  sanitizeFilename,
} from '../artifact/export-helpers.js';
import {
  resolveInsideProject,
  readFileBinaryWithGuards,
  readFileWithGuards,
} from './files-core.js';
import { projectStore } from '../projects/store.js';
import { kodaxHost } from '../kodax/host.js';

/**
 * 文件扩展名 → 可预览的 artifact kind。
 *   - html/htm → html（sandbox iframe 渲染）
 *   - svg      → svg
 *   - md/markdown → markdown
 *   - 其它一律 'code'（按文本代码渲染，带语法高亮）
 * 返回的 kind 永远是"内容型"（content-backed），不会是 doc/image/react。
 */
export function previewKindForPath(p: string): ArtifactKindT {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'svg':
      return 'svg';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'avif':
    case 'mp4':
    case 'm4v':
    case 'mov':
    case 'webm':
    case 'ogv':
    case 'ogg':
    case 'mkv':
    case 'avi':
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'opus':
    case 'ppt':
    case 'pptx':
    case 'pptm':
    case 'potx':
    case 'potm':
    case 'ppsx':
    case 'ppsm':
    case 'log':
    case 'txt':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
    case 'csv':
    case 'tsv':
      return 'file';
    default:
      return 'code';
  }
}

function isPathPreviewKind(kind: ArtifactKindT): kind is 'pdf' | 'docx' | 'xlsx' | 'file' {
  return kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'file';
}

export function previewKindForContent(path: string, content: string): ArtifactKindT {
  const kind = previewKindForPath(path);
  return kind === 'html' && looksLikeInteractiveHtml(content) ? 'interactive-html' : kind;
}

const MARKDOWN_LOCAL_IMAGE_MAX_BYTES = 768 * 1024;

function markdownImageMimeForPath(p: string): string | null {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    default:
      return null;
  }
}

function isRemoteOrInlineResource(raw: string): boolean {
  return /^(?:https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(raw.trim());
}

function splitResourceSuffix(raw: string): { resourcePath: string; suffix: string } {
  const hash = raw.indexOf('#');
  const query = raw.indexOf('?');
  const cut = hash === -1 ? query : query === -1 ? hash : Math.min(hash, query);
  if (cut === -1) return { resourcePath: raw, suffix: '' };
  return { resourcePath: raw.slice(0, cut), suffix: raw.slice(cut) };
}

function decodeResourcePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function toProjectRelativeInside(root: string, target: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

async function resolveMarkdownImageTarget(
  decodedPath: string,
  markdownDir: string,
  realRoot: string,
  projectRoot: string,
): Promise<string | null> {
  const lexicalTarget = decodedPath.startsWith('/')
    ? path.resolve(realRoot, `.${decodedPath}`)
    : path.resolve(markdownDir, decodedPath);
  const relativePath = toProjectRelativeInside(realRoot, lexicalTarget);
  if (!relativePath) return null;
  try {
    return await resolveInsideProject(projectRoot, relativePath);
  } catch {
    return null;
  }
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => Promise<string>,
): Promise<string> {
  let out = '';
  let lastIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += input.slice(lastIndex, index);
    out += await replacer(match);
    lastIndex = index + match[0].length;
  }
  return out + input.slice(lastIndex);
}

export async function inlineMarkdownImageAssets(
  markdown: string,
  markdownAbsPath: string,
  projectRoot: string,
): Promise<string> {
  let remainingBytes = Math.max(
    0,
    MAX_ARTIFACT_CONTENT_BYTES - Buffer.byteLength(markdown, 'utf8') - 4096,
  );
  const markdownDir = path.dirname(markdownAbsPath);
  const realRoot = await fs.realpath(path.resolve(projectRoot));
  const cache = new Map<string, Promise<string | null>>();

  const inlineOne = (rawUrl: string): Promise<string | null> => {
    const trimmed = rawUrl.trim();
    if (!trimmed || isRemoteOrInlineResource(trimmed)) return Promise.resolve(null);
    const cached = cache.get(trimmed);
    if (cached) return cached;
    const task = (async (): Promise<string | null> => {
      const { resourcePath } = splitResourceSuffix(trimmed);
      const decoded = decodeResourcePath(resourcePath);
      const target = await resolveMarkdownImageTarget(
        decoded,
        markdownDir,
        realRoot,
        projectRoot,
      );
      if (!target) return null;
      const mime = markdownImageMimeForPath(target);
      if (!mime || remainingBytes <= 0) return null;
      const maxRawBytes = Math.min(
        MARKDOWN_LOCAL_IMAGE_MAX_BYTES,
        Math.max(0, Math.floor(remainingBytes * 0.75)),
      );
      if (maxRawBytes <= 0) return null;
      try {
        const image = await readFileBinaryWithGuards(target, maxRawBytes);
        if (image.truncated) return null;
        const dataUri = `data:${mime};base64,${image.base64}`;
        const dataBytes = Buffer.byteLength(dataUri, 'utf8');
        if (dataBytes > remainingBytes) return null;
        remainingBytes -= dataBytes;
        return dataUri;
      } catch {
        return null;
      }
    })();
    cache.set(trimmed, task);
    return task;
  };

  let out = await replaceAsync(
    markdown,
    /(!\[[^\]\n]*\]\(\s*)([^)\s]+)([^)]*\))/g,
    async (match) => {
      const url = match[2] ?? '';
      const inlined = await inlineOne(url);
      return inlined ? `${match[1] ?? ''}${inlined}${match[3] ?? ''}` : match[0];
    },
  );

  out = await replaceAsync(
    out,
    /(\s(?:src|poster)\s*=\s*)(["'])([^"']+)(\2)/gi,
    async (match) => {
      const url = match[3] ?? '';
      const inlined = await inlineOne(url);
      return inlined
        ? `${match[1] ?? ''}${match[2] ?? '"'}${inlined}${match[4] ?? match[2] ?? '"'}`
        : match[0];
    },
  );

  out = await replaceAsync(out, /(\ssrcset\s*=\s*)(["'])([^"']+)(\2)/gi, async (match) => {
    const rawSrcset = match[3] ?? '';
    const parts = await Promise.all(
      rawSrcset.split(',').map(async (candidate) => {
        const leading = candidate.match(/^\s*/)?.[0] ?? '';
        const trailing = candidate.match(/\s*$/)?.[0] ?? '';
        const body = candidate.trim();
        if (!body) return candidate;
        const [url, ...descriptor] = body.split(/\s+/);
        if (!url) return candidate;
        const inlined = await inlineOne(url);
        const nextBody = [inlined ?? url, ...descriptor].join(' ');
        return `${leading}${nextBody}${trailing}`;
      }),
    );
    return `${match[1] ?? ''}${match[2] ?? '"'}${parts.join(',')}${match[4] ?? match[2] ?? '"'}`;
  });

  return out;
}

// Lazy electron access (dialog/BrowserWindow) — avoids a top-level 'electron'
// import so this module stays importable under the tsx/esm test loader.
function getElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return req('electron') as typeof import('electron');
}

export function registerArtifactChannels(): void {
  registerChannel('artifact.create', async (input) => {
    if (input.path !== undefined) {
      let session = kodaxHost.get(input.sessionId);
      if (!session && (await kodaxHost.tryResume(input.sessionId))) {
        session = kodaxHost.get(input.sessionId);
      }
      if (!session) throw new Error('session not found for artifact path validation');
      const projectRoot = await projectStore.assertAllowed(session.projectRoot);
      await resolveInsideProject(projectRoot, input.path);
    }
    const res = await artifactStore.upsert(input);
    pushToRenderer('artifact.changed', {
      id: res.id,
      sessionId: input.sessionId,
      reason: res.created ? 'created' : 'version',
    });
    return { id: res.id, version: res.version };
  });

  // Read-only preview: opening a file in the Artifact surface must not persist it
  // into the generated-artifact list.
  registerChannel('artifact.previewFile', async (input) => {
    await projectStore.assertAllowed(input.projectRoot);
    const absPath = await resolveInsideProject(input.projectRoot, input.path);
    const slash = Math.max(input.path.lastIndexOf('/'), input.path.lastIndexOf('\\'));
    const base = slash >= 0 ? input.path.slice(slash + 1) : input.path;
    const title = input.path.length <= 256 ? input.path : base.slice(0, 256);
    const pathKind = previewKindForPath(input.path);

    try {
      const st = await fs.stat(absPath);
      if (!st.isFile()) throw new Error('file not found or is a directory');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        throw new Error('file not found or is a directory');
      }
      throw err;
    }

    if (isPathPreviewKind(pathKind)) {
      return {
        title,
        kind: pathKind,
        path: input.path,
      };
    }

    let read;
    try {
      read = await readFileWithGuards(absPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        throw new Error('file not found or is a directory');
      }
      throw err;
    }
    if (read.isBinary) throw new Error('binary file cannot be previewed');
    if (read.truncated) throw new Error('file too large to preview');

    const kind = previewKindForContent(input.path, read.content);
    const content =
      kind === 'markdown'
        ? await inlineMarkdownImageAssets(read.content, absPath, input.projectRoot)
        : read.content;
    if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_CONTENT_BYTES) {
      throw new Error('file too large to preview');
    }

    return {
      kind,
      title,
      content,
      path: input.path,
    };
  });

  registerChannel('artifact.list', async (input) => {
    const artifacts = await artifactStore.list(input ?? undefined);
    return { artifacts };
  });

  registerChannel('artifact.read', async (input) => {
    const res = await artifactStore.read(input.id, input.version);
    if (!res) {
      throw new Error(
        input.version !== undefined
          ? `artifact ${input.id} has no version ${input.version}`
          : `artifact not found: ${input.id}`,
      );
    }
    return res;
  });

  registerChannel('artifact.delete', async (input) => {
    const deleted = await artifactStore.delete(input.id);
    if (deleted) pushToRenderer('artifact.changed', { id: input.id, reason: 'deleted' });
    return { deleted };
  });

  // Save a content-backed artifact version to a user-chosen file (native dialog).
  registerChannel('artifact.export', async (input) => {
    const res = await artifactStore.read(input.id, input.version);
    if (!res) throw new Error(`artifact not found: ${input.id}`);
    if (res.content === undefined) {
      // doc kinds (path-backed) aren't exported here — already files on disk.
      return { ok: false, error: '该类型 artifact 不支持导出（无内联内容）。' };
    }
    const kind = res.ref.kind;
    let ext: string;
    let bytes: Buffer;
    if (kind === 'image') {
      const parsed = parseDataUri(res.content);
      if (!parsed) return { ok: false, error: '图片数据无效。' };
      ext = extForImageMime(parsed.mime);
      bytes = parsed.data;
    } else {
      ext = extForKind(kind);
      bytes = Buffer.from(res.content, 'utf8');
    }
    const { dialog, BrowserWindow } = getElectron();
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const defaultPath = `${sanitizeFilename(res.ref.title) || 'artifact'}.${ext}`;
    const r = parent
      ? await dialog.showSaveDialog(parent, { defaultPath })
      : await dialog.showSaveDialog({ defaultPath });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fs.writeFile(r.filePath, bytes);
    return { ok: true, path: r.filePath };
  });
}

// openPath — "点一个文件路径/URL 应该发生什么" 的智能路由（2026-06-18 用户反馈）。
//
// 之前 renderer 里到处展示文件路径却全是死文本（聊天 tool 卡、右侧 Context 栏、diff 头）。
// 这里给出一条统一入口 openFileSmart(path)，按扩展名智能路由：
//   - html/svg/md → 在 File Viewer 里沙盒 iframe 预览（files.read）
//   - 代码/文本    → App 内 DiffPanel popout（复用 setLastDiffPath + requestPopout('diff')）
//   - 其它（图片/pdf/二进制/未知）→ 在系统文件管理器里定位（shell.revealPath）
//
// 所有"触达系统 shell"的动作都走 main 端白名单 channel（reveal 不执行目标、openExternal 仅 http/s），
// 见 packages/space-ipc-schema/src/channels/shell.ts 的安全说明。

import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { pushToast } from '../store/toastStore.js';
import { translateMessage } from '../i18n/I18nProvider.js';
import {
  OPEN_FILE_VIEWER_EVENT,
  type TransientArtifactSnapshot,
} from '../features/artifact/transientArtifact.js';
import {
  fileViewerContentKind,
  isPreviewablePath,
  isCodePath,
  toProjectRelative,
} from './pathClassify.js';
import { detectKind, type RichPreviewKind } from '../features/preview/binaryUtils.js';
import { partnerDeliveryPreviewVersion } from './generatedResourceRef.js';
import {
  isPartnerOutputLogicalPath,
  parsePartnerDeliveryUri,
  type ArtifactKindT,
  type PartnerDeliveryRefT,
  type PartnerDeliveryReferenceT,
  type PartnerDeliveryResolveStatusT,
} from '@kodax-space/space-ipc-schema';

// 纯分类/归一化逻辑在 pathClassify.ts（可被 node:test 单测）；这里转出常用的几个，
// 让 caller 仍从 openPath import（单一入口）。
export { extOf, isPreviewablePath, looksLikeFilePath, toProjectRelative } from './pathClassify.js';

interface OpenCtx {
  readonly sessionId?: string | null;
  readonly projectRoot?: string | null;
  readonly surface?: 'code' | 'partner';
}

/** File Viewer only needs an allowed project; it is deliberately Session-independent. */
interface PreviewCtx {
  readonly projectRoot: string;
  readonly notifyOnError?: boolean;
}

function hashId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

let fileViewerRevision = Date.now();

function nextFileViewerRevision(): number {
  fileViewerRevision = Math.max(fileViewerRevision + 1, Date.now());
  return fileViewerRevision;
}

function artifactKindForRichPreview(kind: RichPreviewKind): ArtifactKindT {
  switch (kind) {
    case 'pdf':
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return kind;
    case 'image':
    case 'video':
    case 'audio':
    case 'text':
      return 'file';
  }
}

function filePreviewSnapshot(detail: {
  readonly projectRoot: string;
  readonly relPath: string;
  readonly kind: ArtifactKindT;
  readonly title: string;
  readonly content?: string;
  readonly path?: string;
}): TransientArtifactSnapshot {
  const version = nextFileViewerRevision();
  const path = detail.path ?? detail.relPath;
  return {
    id: `file-preview-${hashId(`${detail.projectRoot}::${detail.relPath}`)}`,
    kind: detail.kind,
    title: detail.title,
    source: 'file-preview',
    version,
    projectRoot: detail.projectRoot,
    ...(detail.content !== undefined ? { content: detail.content } : {}),
    ...(path !== undefined ? { path } : {}),
    versions: [
      {
        v: version,
        ...(detail.content !== undefined ? { content: detail.content } : {}),
        ...(path !== undefined ? { path } : {}),
      },
    ],
  };
}

function openFileViewerInSidebar(snapshot: TransientArtifactSnapshot): void {
  useAppStore.getState().setRightSidebarOpen(true);
  const dispatch = (): void => {
    window.dispatchEvent(new CustomEvent(OPEN_FILE_VIEWER_EVENT, { detail: { snapshot } }));
  };
  dispatch();
  window.setTimeout(dispatch, 0);
}

type PartnerDeliveryOpenResult = PartnerDeliveryResolveStatusT | 'opened' | 'unavailable';

async function openPartnerDeliveryReference(
  reference: PartnerDeliveryReferenceT,
  projectRoot: string | null,
  sessionId: string | null,
): Promise<PartnerDeliveryOpenResult> {
  const bridge = window.kodaxSpace;
  if (!bridge || !projectRoot) return 'unavailable';
  try {
    const result = await bridge.invoke('partner.deliveries.resolve', {
      projectRoot,
      ...(sessionId ? { sessionId } : {}),
      reference,
    });
    if (!result.ok) return 'unavailable';
    if (result.data.status !== 'found' || !result.data.delivery) return result.data.status;
    return (await openPartnerDeliveryInViewer(result.data.delivery)) ? 'opened' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function notifyPartnerDeliveryFailure(result: PartnerDeliveryOpenResult): void {
  if (result === 'opened') return;
  const key =
    result === 'ambiguous'
      ? 'openPath.partnerOutputAmbiguous'
      : result === 'missing'
        ? 'openPath.partnerOutputMissing'
        : result === 'not-found'
          ? 'openPath.partnerOutputNotFound'
          : 'openPath.partnerOutputResolveFailed';
  pushToast(translateMessage(key), result === 'unavailable' ? 'error' : 'warning');
}

async function openPartnerDeliveryPath(
  rawPath: string,
  projectRoot: string | null,
  sessionId: string | null,
): Promise<PartnerDeliveryOpenResult> {
  return openPartnerDeliveryReference({ type: 'path', path: rawPath }, projectRoot, sessionId);
}

/** Open a Partner output through its stable Delivery identity, scoped to the active context. */
export async function openPartnerDeliveryById(deliveryId: string, ctx?: OpenCtx): Promise<boolean> {
  const app = useAppStore.getState();
  const result = await openPartnerDeliveryReference(
    { type: 'id', id: deliveryId },
    ctx?.projectRoot ?? app.currentProjectPath,
    ctx?.sessionId ?? app.currentSessionId,
  );
  notifyPartnerDeliveryFailure(result);
  return result === 'opened';
}

/** Handle a typed generated-resource URI. Returns false only when the URI is not ours. */
export async function openGeneratedResourceHref(href: string, ctx?: OpenCtx): Promise<boolean> {
  const deliveryId = parsePartnerDeliveryUri(href);
  if (!deliveryId) return false;
  await openPartnerDeliveryById(deliveryId, ctx);
  return true;
}

/** Open a registered Partner output in the transient File Viewer. */
export async function openPartnerDeliveryInViewer(delivery: PartnerDeliveryRefT): Promise<boolean> {
  if (delivery.kind !== 'file') return revealPath(delivery.absolutePath);

  const version = partnerDeliveryPreviewVersion(delivery.updatedAt);
  const snapshot: TransientArtifactSnapshot = {
    id: `delivery-preview-${delivery.id}`,
    kind: 'file',
    title: delivery.title,
    source: 'delivery-preview',
    version,
    path: delivery.relativePath,
    fileSource: 'delivery-store',
    deliveryId: delivery.id,
    versions: [
      {
        v: version,
        path: delivery.relativePath,
        fileSource: 'delivery-store',
        deliveryId: delivery.id,
      },
    ],
  };
  openFileViewerInSidebar(snapshot);
  return true;
}

export function isAbsolutePathOutsideProject(rawPath: string, projectRoot: string): boolean {
  const p = rawPath.replace(/\\/g, '/');
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const isAbsolute = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (!isAbsolute) return false;
  const a = p.toLowerCase();
  const b = root.toLowerCase();
  return a !== b && !a.startsWith(`${b}/`);
}

/** 系统浏览器打开 http(s) URL。 */
export async function openExternalUrl(url: string): Promise<void> {
  const bridge = window.kodaxSpace;
  if (!bridge) return;
  try {
    const r = await bridge.invoke('shell.openExternal', { url });
    if (!r.ok || !r.data.opened) pushToast(translateMessage('openPath.linkOpenFailed'), 'error');
  } catch {
    pushToast(translateMessage('openPath.linkOpenFailed'), 'error');
  }
}

/** 在系统文件管理器里定位高亮文件。rawPath 绝对则直接定位；相对则配 projectRoot 解析。 */
export async function revealPath(rawPath: string, projectRoot?: string | null): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge) return false;
  try {
    const r = await bridge.invoke(
      'shell.revealPath',
      projectRoot ? { path: rawPath, projectRoot } : { path: rawPath },
    );
    if (r.ok && r.data.revealed) return true;
    pushToast(translateMessage('openPath.fileNotFound'), 'warning');
    return false;
  } catch {
    pushToast(translateMessage('openPath.revealFailed'), 'error');
    return false;
  }
}

/** Open an allowlisted directory itself in the system file manager. */
export async function openDirectory(
  rawPath: string,
  projectRoot?: string | null,
): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge) return false;
  try {
    const r = await bridge.invoke(
      'shell.openDirectory',
      projectRoot ? { path: rawPath, projectRoot } : { path: rawPath },
    );
    if (r.ok && r.data.opened) return true;
    pushToast(translateMessage('openPath.directoryNotFound'), 'warning');
    return false;
  } catch {
    pushToast(translateMessage('openPath.directoryOpenFailed'), 'error');
    return false;
  }
}

/** Load one allowed project file into a transient File Viewer snapshot. */
export async function loadFileViewerSnapshot(
  rawPath: string,
  projectRoot: string,
): Promise<TransientArtifactSnapshot> {
  const bridge = window.kodaxSpace;
  if (!bridge) throw new Error(translateMessage('artifact.runtimeUnavailable'));
  const rel = toProjectRelative(rawPath, projectRoot);
  const richKind = detectKind(rel);
  if (richKind !== null) {
    const stat = await bridge.invoke('files.stat', { projectRoot, path: rel });
    if (!stat.ok) {
      throw new Error(stat.error?.message ?? translateMessage('common.unknownError'));
    }
    if (!stat.data.exists || stat.data.kind !== 'file') {
      throw new Error(translateMessage('openPath.fileNotFound'));
    }
    return filePreviewSnapshot({
      projectRoot,
      relPath: rel,
      kind: artifactKindForRichPreview(richKind),
      title: rel,
      path: rel,
    });
  }

  const r = await bridge.invoke('files.read', {
    projectRoot,
    path: rel,
  });
  if (!r.ok) throw new Error(r.error?.message ?? translateMessage('common.unknownError'));
  if (r.data.isBinary) throw new Error('binary file cannot be previewed');
  if (r.data.truncated) throw new Error('file too large to preview');
  return filePreviewSnapshot({
    projectRoot,
    relPath: rel,
    kind: fileViewerContentKind(rel, r.data.content),
    title: rel,
    content: r.data.content,
    path: rel,
  });
}

/** Open a project file in File Viewer without creating or requiring a Session. */
export async function previewFileInViewer(rawPath: string, ctx: PreviewCtx): Promise<boolean> {
  const notifyFailure = (message: string): void => {
    if (!ctx.notifyOnError) return;
    pushToast(translateMessage('openPath.previewFailedWithMessage', { message }), 'error');
  };
  try {
    const snapshot = await loadFileViewerSnapshot(rawPath, ctx.projectRoot);
    openFileViewerInSidebar(snapshot);
    return true;
  } catch (err) {
    notifyFailure(
      err instanceof Error && err.message.trim()
        ? err.message
        : translateMessage('common.unknownError'),
    );
    return false;
  }
}

/** Force a file into File Viewer, even when smart routing would normally prefer diff. */
export async function openFileInViewer(rawPath: string, ctx?: OpenCtx): Promise<boolean> {
  const path = rawPath.trim();
  if (path.length === 0 || path.length > 4096) return false;

  const app = useAppStore.getState();
  const activeSessionId = ctx?.sessionId ?? app.currentSessionId;
  const projectRoot = ctx?.projectRoot ?? app.currentProjectPath;
  const surface = ctx?.surface ?? useSurfaceStore.getState().currentSurface;

  const typedDeliveryId = parsePartnerDeliveryUri(path);
  if (typedDeliveryId) {
    return openPartnerDeliveryById(typedDeliveryId, {
      sessionId: activeSessionId,
      projectRoot,
      surface,
    });
  }

  if (surface === 'partner' && isPartnerOutputLogicalPath(path)) {
    const result = await openPartnerDeliveryPath(path, projectRoot, activeSessionId);
    notifyPartnerDeliveryFailure(result);
    return result === 'opened';
  }

  if (!projectRoot) {
    pushToast(translateMessage('openPath.previewNoProject'), 'warning');
    return false;
  }

  return previewFileInViewer(path, { projectRoot, notifyOnError: true });
}

function openDiffPanelForPath(rawPath: string, projectRoot: string): void {
  const rel = toProjectRelative(rawPath, projectRoot);
  useAppStore.getState().setLastDiffPath(rel || rawPath);
  useAppStore.getState().requestPopout('diff');
}

/** 在 App 内 DiffPanel popout 打开文件（复用 tool-call/git diff 链路）。 */
export async function openInDiff(rawPath: string, projectRoot: string | null): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge || !projectRoot) {
    pushToast(translateMessage('openPath.diffNoProject'), 'warning');
    return false;
  }
  if (isAbsolutePathOutsideProject(rawPath, projectRoot)) {
    pushToast(translateMessage('openPath.diffOutsideProject'), 'warning');
    return false;
  }
  const rel = toProjectRelative(rawPath, projectRoot);
  try {
    const check = await bridge.invoke('files.diff', { projectRoot, path: rel });
    if (!check.ok) {
      pushToast(
        translateMessage('openPath.diffFailedWithMessage', {
          message: check.error?.message ?? translateMessage('openPath.invalidPath'),
        }),
        'error',
      );
      return false;
    }
  } catch (err) {
    pushToast(
      translateMessage('openPath.diffFailedWithMessage', {
        message:
          err instanceof Error && err.message.trim()
            ? err.message
            : translateMessage('common.unknownError'),
      }),
      'error',
    );
    return false;
  }
  openDiffPanelForPath(rawPath, projectRoot);
  return true;
}

async function pathHasDiff(rawPath: string, projectRoot: string): Promise<boolean | null> {
  const bridge = window.kodaxSpace;
  if (!bridge) return null;
  const rel = toProjectRelative(rawPath, projectRoot);
  let checked = false;

  try {
    const cached = await bridge.invoke('files.diff', { projectRoot, path: rel });
    if (cached.ok) {
      checked = true;
      if (cached.data.available) return true;
    }
  } catch {
    // Cache misses/errors should not block the git fallback.
  }

  try {
    const git = await bridge.invoke('project.gitFileDiff', { projectRoot, path: rel });
    if (git.ok) {
      checked = true;
      if (git.data.available) return true;
    }
  } catch {
    // Unknown diff state falls back to the caller's normal file handling.
  }

  return checked ? false : null;
}

/**
 * 智能路由：点一个文件路径应该发生什么。ctx 缺省时从 store 读当前 session/project/surface。
 *   代码型有变更 → App 内 diff；代码型无变更/预览型 → File Viewer；其它 → 文件管理器定位。
 * 上游分支失败（无项目、文件不存在等）一律优雅回退到 reveal。
 */
export async function openFileSmart(rawPath: string, ctx?: OpenCtx): Promise<void> {
  const path = rawPath.trim();
  // 边界守门：空 / 超长直接丢（IPC schema 上限 4096；DiffView/RightSidebar 等 caller 不经
  // looksLikeFilePath 的长度过滤，这里兜一道，避免把异常长的 LLM 串送进 IPC）。
  if (path.length === 0 || path.length > 4096) return;

  const app = useAppStore.getState();
  const sessionId = ctx?.sessionId ?? app.currentSessionId;
  const projectRoot = ctx?.projectRoot ?? app.currentProjectPath;
  const surface = ctx?.surface ?? useSurfaceStore.getState().currentSurface;

  const typedDeliveryId = parsePartnerDeliveryUri(path);
  if (typedDeliveryId) {
    await openPartnerDeliveryById(typedDeliveryId, { sessionId, projectRoot, surface });
    return;
  }

  // `partner-output/` is a logical Delivery namespace, not a project-relative directory.
  // Resolve it first so a same-named project file cannot shadow the generated output.
  if (surface === 'partner' && isPartnerOutputLogicalPath(path)) {
    const result = await openPartnerDeliveryPath(path, projectRoot, sessionId);
    notifyPartnerDeliveryFailure(result);
    return;
  }

  if (isCodePath(path) && projectRoot) {
    const hasDiff = await pathHasDiff(path, projectRoot);
    if (hasDiff === true) {
      openDiffPanelForPath(path, projectRoot);
      return;
    }
    const ok = await previewFileInViewer(path, { projectRoot });
    if (ok) return;
    if (surface === 'partner') {
      const deliveryResult = await openPartnerDeliveryPath(path, projectRoot, sessionId);
      if (deliveryResult === 'opened') return;
      if (deliveryResult === 'ambiguous' || deliveryResult === 'missing') {
        notifyPartnerDeliveryFailure(deliveryResult);
        return;
      }
    }
    await revealPath(path, projectRoot);
    return;
  }

  if (isPreviewablePath(path) && projectRoot) {
    const ok = await previewFileInViewer(path, { projectRoot });
    if (ok) return;
    // 预览失败（二进制/过大/不存在）→ 回退到定位。
  }

  if (surface === 'partner') {
    const deliveryResult = await openPartnerDeliveryPath(path, projectRoot, sessionId);
    if (deliveryResult === 'opened') return;
    if (deliveryResult === 'ambiguous' || deliveryResult === 'missing') {
      notifyPartnerDeliveryFailure(deliveryResult);
      return;
    }
  }

  await revealPath(path, projectRoot);
}

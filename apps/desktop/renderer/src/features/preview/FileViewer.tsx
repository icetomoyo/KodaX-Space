import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileText, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { ArtifactView } from '../artifact/ArtifactView.js';
import { toArtifactContent, type ArtifactVersionPayload } from '../artifact/toArtifactContent.js';
import type { TransientArtifactSnapshot } from '../artifact/transientArtifact.js';
import { loadFileViewerSnapshot } from '../../lib/openPath.js';
import { ProjectWebPreview } from './ProjectWebPreview.js';

interface FileViewerProps {
  readonly snapshot: TransientArtifactSnapshot;
  readonly onSnapshotChange: (snapshot: TransientArtifactSnapshot) => void;
}

function currentSnapshotPayload(snapshot: TransientArtifactSnapshot): {
  version: number;
  payload: ArtifactVersionPayload;
} {
  const versions = snapshot.versions ?? [];
  const version =
    snapshot.version ??
    (versions.length > 0 ? Math.max(...versions.map((candidate) => candidate.v)) : 1);
  const selected = versions.find((candidate) => candidate.v === version);
  const path = selected?.path ?? snapshot.path;
  return {
    version,
    payload: {
      ...(selected?.content !== undefined
        ? { content: selected.content }
        : snapshot.content !== undefined
          ? { content: snapshot.content }
          : {}),
      ...(path !== undefined ? { path } : {}),
      ...(selected?.fileSource !== undefined
        ? { fileSource: selected.fileSource }
        : snapshot.fileSource !== undefined
          ? { fileSource: snapshot.fileSource }
          : path !== undefined
            ? { fileSource: 'workspace' as const }
            : {}),
      ...(selected?.deliveryId !== undefined
        ? { deliveryId: selected.deliveryId }
        : snapshot.deliveryId !== undefined
          ? { deliveryId: snapshot.deliveryId }
          : {}),
    },
  };
}

export function FileViewer({ snapshot, onSnapshotChange }: FileViewerProps): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((state) => state.currentProjectPath);
  const projectRoot = snapshot.projectRoot ?? currentProjectPath;
  const [refreshing, setRefreshing] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [networkAccess, setNetworkAccess] = useState(false);
  const { version, payload } = currentSnapshotPayload(snapshot);
  const snapshotKey = `${snapshot.id}:${version}:${snapshot.path ?? ''}:${projectRoot ?? ''}`;
  const activeSnapshotKeyRef = useRef(snapshotKey);
  activeSnapshotKeyRef.current = snapshotKey;
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    setRefreshing(false);
    setOperationError(null);
    setCopied(false);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
  }, [snapshotKey]);
  useEffect(() => setNetworkAccess(false), [snapshot.id]);
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const content = useMemo(
    () =>
      toArtifactContent(snapshot.kind, payload, projectRoot, snapshot.permissions, {
        id: snapshot.id,
        version,
      }),
    [payload, projectRoot, snapshot.id, snapshot.kind, snapshot.permissions, version],
  );
  const displayPath = snapshot.path ?? snapshot.title;
  const isProjectHtml =
    snapshot.source === 'file-preview' &&
    projectRoot !== null &&
    snapshot.path !== undefined &&
    /\.html?$/i.test(snapshot.path);
  const canRefresh =
    snapshot.source === 'file-preview' && projectRoot !== null && snapshot.path !== undefined;

  async function refresh(): Promise<void> {
    if (!canRefresh || !projectRoot || !snapshot.path) return;
    const requestSnapshotKey = snapshotKey;
    setRefreshing(true);
    setOperationError(null);
    try {
      const next = await loadFileViewerSnapshot(snapshot.path, projectRoot);
      if (activeSnapshotKeyRef.current !== requestSnapshotKey) return;
      onSnapshotChange(next);
    } catch (error) {
      if (activeSnapshotKeyRef.current !== requestSnapshotKey) return;
      const message =
        error instanceof Error && error.message.trim() ? error.message : t('common.unknownError');
      setOperationError(`${t('fileViewer.refreshFailed')}: ${message}`);
    } finally {
      if (activeSnapshotKeyRef.current === requestSnapshotKey) setRefreshing(false);
    }
  }

  async function copyPath(): Promise<void> {
    const requestSnapshotKey = snapshotKey;
    try {
      await navigator.clipboard.writeText(displayPath);
      if (activeSnapshotKeyRef.current !== requestSnapshotKey) return;
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1500);
    } catch {
      if (activeSnapshotKeyRef.current === requestSnapshotKey) {
        setOperationError(t('fileViewer.copyFailed'));
      }
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col" data-testid="file-viewer">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-default px-3 py-1.5">
        <FileText
          className="h-3.5 w-3.5 flex-shrink-0 text-fg-muted"
          strokeWidth={1.65}
          aria-hidden
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-secondary"
          title={displayPath}
        >
          {displayPath}
        </span>
        <div className="flex items-center gap-0.5">
          {isProjectHtml && (
            <button
              type="button"
              onClick={() => setNetworkAccess((current) => !current)}
              aria-pressed={networkAccess}
              className={`inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-3 ${
                networkAccess
                  ? 'bg-accent/10 text-accent-ink'
                  : 'text-fg-muted hover:text-fg-primary'
              }`}
              title={networkAccess ? t('fileViewer.disableNetwork') : t('fileViewer.enableNetwork')}
              aria-label={
                networkAccess ? t('fileViewer.disableNetwork') : t('fileViewer.enableNetwork')
              }
            >
              {networkAccess ? (
                <Wifi className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              ) : (
                <WifiOff className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          )}
          {canRefresh && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary disabled:opacity-50"
              title={t('fileViewer.refresh')}
              aria-label={t('fileViewer.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyPath()}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
            title={copied ? t('fileViewer.pathCopied') : t('fileViewer.copyPath')}
            aria-label={copied ? t('fileViewer.pathCopied') : t('fileViewer.copyPath')}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-ok" strokeWidth={2} aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
      </div>
      {operationError && (
        <div
          className="flex-shrink-0 border-b border-border-default px-3 py-1.5 text-[11px] text-danger"
          role="alert"
        >
          {operationError}
        </div>
      )}
      {isProjectHtml && projectRoot && snapshot.path ? (
        <ProjectWebPreview
          projectRoot={projectRoot}
          path={snapshot.path}
          revision={version}
          networkAccess={networkAccess}
        />
      ) : content ? (
        <ArtifactView {...content} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-fg-muted">
          {t('fileViewer.cannotPreview')}
        </div>
      )}
    </div>
  );
}

// SourcesPanel — Partner three-column left rail: sources.
//
// MVP: attach workspace files to the current Partner session. The agent sees
// source ids in the Partner prompt overlay and can read them through the
// readonly partner_source_read tool.
import { useCallback, useEffect, useState } from 'react';
import type { PartnerSourceT } from '@kodax-space/space-ipc-schema';
import { FileText, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { FileTree } from '../code/FileTree.js';
import { AdminAuditPanel } from './AdminAuditPanel.js';
import { KnowledgeBasePanel } from './KnowledgeBasePanel.js';
import {
  PARTNER_SOURCES_CHANGED_EVENT,
  readPartnerPendingSources,
  removePartnerPendingSource,
  stagePartnerPendingSource,
  type PartnerWorkbenchPendingSourceRef,
} from './partnerWorkbench.js';

function notifySourcesChanged(): void {
  window.dispatchEvent(new Event(PARTNER_SOURCES_CHANGED_EVENT));
}

export function SourcesPanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sources, setSources] = useState<readonly PartnerSourceT[]>([]);
  const [pendingSources, setPendingSources] = useState<readonly PartnerWorkbenchPendingSourceRef[]>(
    () => readPartnerPendingSources(useAppStore.getState().currentProjectPath),
  );
  const [loadingSources, setLoadingSources] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderName = currentProjectPath
    ? (currentProjectPath.split(/[\\/]/).filter(Boolean).pop() ?? currentProjectPath)
    : null;

  const loadSources = useCallback((): (() => void) | void => {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentSessionId || !currentProjectPath) {
      setSources([]);
      setLoadingSources(false);
      return;
    }
    let alive = true;
    setLoadingSources(true);
    setError(null);
    bridge
      .invoke('partner.sources.list', {
        sessionId: currentSessionId,
        projectRoot: currentProjectPath,
      })
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setSources(result.data.sources);
        } else {
          setSources([]);
          setError(result.error.message);
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSources([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoadingSources(false);
      });
    return () => {
      alive = false;
    };
  }, [currentProjectPath, currentSessionId]);

  const loadPendingSources = useCallback((): void => {
    setPendingSources(readPartnerPendingSources(currentProjectPath));
  }, [currentProjectPath]);

  useEffect(() => {
    setSelectedPath(null);
  }, [currentProjectPath, currentSessionId]);

  useEffect(() => loadSources(), [loadSources]);

  useEffect(() => loadPendingSources(), [loadPendingSources]);

  useEffect(() => {
    const onSourcesChanged = (): void => {
      loadPendingSources();
    };
    window.addEventListener(PARTNER_SOURCES_CHANGED_EVENT, onSourcesChanged);
    return () => window.removeEventListener(PARTNER_SOURCES_CHANGED_EVENT, onSourcesChanged);
  }, [loadPendingSources]);

  async function addSelectedSource(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!currentProjectPath || !selectedPath) return;
    if (!currentSessionId) {
      setPendingSources(stagePartnerPendingSource(currentProjectPath, { path: selectedPath }));
      notifySourcesChanged();
      return;
    }
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.invoke('partner.sources.add', {
        sessionId: currentSessionId,
        kind: 'workspace_path',
        projectRoot: currentProjectPath,
        path: selectedPath,
        targetKind: 'file',
      });
      if (result.ok) {
        setSources((prev) => {
          const others = prev.filter((source) => source.id !== result.data.source.id);
          return [...others, result.data.source];
        });
        notifySourcesChanged();
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(sourceId: string): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!currentProjectPath) return;
    if (!currentSessionId) {
      setPendingSources(removePartnerPendingSource(currentProjectPath, sourceId));
      notifySourcesChanged();
      return;
    }
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.invoke('partner.sources.remove', {
        sessionId: currentSessionId,
        projectRoot: currentProjectPath,
        sourceId,
      });
      if (result.ok && result.data.removed) {
        setSources((prev) => prev.filter((source) => source.id !== sourceId));
        notifySourcesChanged();
      } else if (!result.ok) {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const visibleSources = currentSessionId
    ? sources.map((source) => ({
        id: source.id,
        path: source.path,
        label: source.label,
        pending: false,
      }))
    : pendingSources.map((source) => ({
        id: source.path,
        path: source.path,
        label: source.label,
        pending: true,
      }));
  const selectedAlreadyAdded = Boolean(
    selectedPath && visibleSources.some((source) => source.path === selectedPath),
  );
  const canAdd = Boolean(currentProjectPath && selectedPath && !busy && !selectedAlreadyAdded);

  return (
    <aside
      className="w-60 flex-shrink-0 border-r border-border-default flex flex-col bg-surface"
      data-testid="partner-sources-panel"
    >
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FolderOpen className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">
          {t('partner.sources.title')}
        </span>
      </div>

      <div className="flex-shrink-0 p-2 border-b border-border-default">
        {folderName ? (
          <div
            className="text-xs text-fg-secondary flex items-center gap-1.5 px-1 py-0.5"
            title={currentProjectPath ?? ''}
          >
            <FolderOpen
              className="w-3.5 h-3.5 flex-shrink-0 text-fg-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="truncate">{folderName}</span>
          </div>
        ) : (
          <div className="text-[11px] text-fg-muted px-1 py-2 leading-relaxed">
            {t('partner.sources.openFolderHint')}
          </div>
        )}
      </div>

      <KnowledgeBasePanel />
      <AdminAuditPanel />

      <div className="flex-shrink-0 border-b border-border-default">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted">
            {t('partner.sources.attached')}
          </span>
          {loadingSources && (
            <Loader2
              className="w-3.5 h-3.5 text-fg-muted animate-spin"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
        </div>
        <div className="max-h-36 overflow-y-auto pb-1">
          {visibleSources.length > 0 ? (
            visibleSources.map((source) => (
              <div
                key={source.id}
                className="group px-2 py-1 flex items-center gap-1.5 text-xs text-fg-secondary"
                title={source.path}
              >
                <FileText
                  className="w-3.5 h-3.5 text-fg-muted flex-shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="truncate">{source.label ?? source.path}</span>
                <button
                  type="button"
                  className="ml-auto w-5 h-5 inline-flex items-center justify-center rounded hover:bg-hover-bg text-fg-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => void removeSource(source.id)}
                  disabled={busy}
                  title={t('partner.sources.remove')}
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            ))
          ) : (
            <div className="px-3 pb-2 text-[11px] text-fg-faint">
              {currentSessionId ? t('partner.sources.none') : t('partner.sources.noneStaged')}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {currentProjectPath ? (
          <FileTree
            projectRoot={currentProjectPath}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        ) : null}
      </div>

      {error && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-border-default text-[11px] text-danger leading-snug">
          {error}
        </div>
      )}

      <div className="flex-shrink-0 p-2 border-t border-border-default">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => void addSelectedSource()}
          className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 ${
            canAdd ? 'text-fg-secondary hover:bg-hover-bg' : 'text-fg-muted cursor-not-allowed'
          }`}
          title={
            selectedPath
              ? currentSessionId
                ? t('partner.sources.attachSelectedTitle')
                : t('partner.sources.stageSelectedTitle')
              : currentSessionId
                ? t('partner.sources.selectFile')
                : t('partner.sources.selectFile')
          }
        >
          {busy ? (
            <Loader2
              className="w-3.5 h-3.5 flex-shrink-0 animate-spin"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <Plus className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          )}
          <span className="truncate">
            {selectedPath
              ? currentSessionId
                ? t('partner.sources.attachSelected')
                : selectedAlreadyAdded
                  ? t('partner.sources.alreadyAttached')
                  : t('partner.sources.stageSelected')
              : t('partner.sources.add')}
          </span>
        </button>
      </div>
    </aside>
  );
}

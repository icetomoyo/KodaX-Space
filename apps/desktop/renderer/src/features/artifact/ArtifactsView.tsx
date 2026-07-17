// ArtifactsView (F059b) — the shared artifact display body: list selector +
// version switcher + ArtifactView render + empty/loading. Surface-agnostic, so
// it's reused by Partner's ArtifactPanel (right column), the Coder RightSidebar
// "Artifact" section, and the full-screen PopoutOverlay. Reads the current
// session from appStore; artifacts are the current session's (any surface).

import { useEffect, useMemo, useState } from 'react';
import { FileOutput, Copy, Check, Download, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ArtifactView } from './ArtifactView';
import { useArtifacts, useArtifactContent } from './useArtifacts';
import { useTranscriptArtifacts } from './useTranscriptArtifacts';
import { toArtifactContent, type ArtifactVersionPayload } from './toArtifactContent';
import { TEXT_COPY_KINDS } from './artifactKind';
import { useI18n } from '../../i18n/I18nProvider';
import type { ArtifactRefT } from '@kodax-space/space-ipc-schema';
import { artifactSessionForProjectFiles } from './filePreviewSession';
import {
  FOCUS_ARTIFACT_EVENT,
  mergeTransientArtifactSnapshots,
  type FocusArtifactEventDetail,
  type TransientArtifactSnapshot,
} from './transientArtifact';

export function ArtifactsEmptyState(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
      <FileOutput className="w-6 h-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
      <div className="text-[12px] text-fg-secondary font-medium">{t('artifact.emptyTitle')}</div>
      <div className="text-[11px] text-fg-muted leading-relaxed max-w-[200px]">
        {t('artifact.emptyDescription')}
      </div>
    </div>
  );
}

export function ArtifactsErrorState({ error }: { error: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
      <FileOutput className="w-6 h-6 text-danger" strokeWidth={1.5} aria-hidden />
      <div className="text-[12px] text-fg-primary font-medium">{t('artifact.loadFailed')}</div>
      <div
        className="text-[11px] text-fg-muted leading-relaxed max-w-[240px] break-words"
        title={error}
      >
        {error}
      </div>
    </div>
  );
}

/** Reads + renders one artifact's selected version. */
function ArtifactViewer({
  artifact,
  projectRoot,
  payloadOverrides,
}: {
  artifact: ArtifactRefT;
  projectRoot: string | null;
  payloadOverrides?: ReadonlyMap<number, ArtifactVersionPayload>;
}): JSX.Element {
  const { t } = useI18n();
  const [version, setVersion] = useState<number | undefined>(undefined); // undefined = current
  const effectiveVersion = version ?? artifact.currentVersion;
  const isTransient = payloadOverrides !== undefined;
  const payloadOverride = payloadOverrides?.get(effectiveVersion);
  const { payload: loadedPayload, loading } = useArtifactContent(
    isTransient ? null : artifact.id,
    version,
  );
  const payload = payloadOverride ?? loadedPayload;
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const setActivePopoutKind = useAppStore((s) => s.setActivePopoutKind);

  const content = useMemo(
    () =>
      payload
        ? toArtifactContent(artifact.kind, payload, projectRoot, artifact.permissions, {
            id: artifact.id,
            version: effectiveVersion,
          })
        : null,
    [payload, artifact.kind, artifact.permissions, projectRoot, artifact.id, effectiveVersion],
  );

  const canCopy = payload?.content !== undefined && TEXT_COPY_KINDS.has(artifact.kind);
  const canSave =
    !isTransient && (payload?.content !== undefined || payload?.fileSource === 'artifact-store');

  async function onCopy(): Promise<void> {
    if (payload?.content == null) return;
    try {
      await navigator.clipboard.writeText(payload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionMsg(t('artifact.copyFailed'));
      setTimeout(() => setActionMsg(null), 2000);
    }
  }

  async function onSave(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const r = await bridge.invoke('artifact.export', {
      id: artifact.id,
      version: effectiveVersion,
    });
    if (!r.ok) {
      // IPC-level failure (e.g. fs.writeFile threw: permission denied / disk full)
      setActionMsg(t('artifact.saveFailed'));
      setTimeout(() => setActionMsg(null), 2500);
    } else if (r.data.ok) {
      setActionMsg(t('artifact.saved'));
      setTimeout(() => setActionMsg(null), 1500);
    } else if (!r.data.canceled) {
      setActionMsg(r.data.error ?? t('artifact.saveFailed'));
      setTimeout(() => setActionMsg(null), 2500);
    } // canceled → no message
  }

  // "再改一版": prefill the composer with a revision instruction referencing this
  // artifact's id; the agent reuses it in create_artifact to add a new version.
  // (Agent-driven → verified with a real LLM session; the prefill itself is local.)
  function onIterate(): void {
    const text = t('artifact.iteratePrompt', { title: artifact.title, id: artifact.id });
    window.dispatchEvent(new CustomEvent('kodax-space.compose-prefill', { detail: { text } }));
    setActivePopoutKind(null); // 若在全屏 popout，关掉让用户看到输入框（侧栏/Partner 下无害）
  }

  // "单独打开"：F059c L3 —— 开独立最大化窗口看这份 artifact（escalation 第三级）。
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* toolbar 恒显示：再改一版对任何 artifact 都可用 */}
      <div className="px-3 py-1.5 border-b border-border-default flex items-center gap-2 flex-shrink-0">
        {artifact.versions.length > 1 && (
          <>
            <span className="text-[10px] text-fg-muted">{t('artifact.version')}</span>
            <select
              className="text-[11px] bg-surface-raised border border-border-default rounded px-1 py-0.5 text-fg-secondary"
              value={effectiveVersion}
              onChange={(e) => setVersion(Number(e.target.value))}
            >
              {artifact.versions
                .slice()
                .sort((a, b) => b.v - a.v)
                .map((v) => (
                  <option key={v.v} value={v.v}>
                    v{v.v}
                    {v.v === artifact.currentVersion ? t('artifact.latestSuffix') : ''}
                  </option>
                ))}
            </select>
          </>
        )}
        {actionMsg && <span className="text-[10px] text-fg-muted truncate">{actionMsg}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onIterate}
            title={t('artifact.iterateTitle')}
            aria-label={t('artifact.iterate')}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
          >
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          {canCopy && (
            <button
              type="button"
              onClick={() => void onCopy()}
              title={t('artifact.copyContent')}
              aria-label={t('artifact.copyContent')}
              className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-ok" strokeWidth={2} />
              ) : (
                <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
              )}
            </button>
          )}
          {canSave && (
            <button
              type="button"
              onClick={() => void onSave()}
              title={t('artifact.saveAs')}
              aria-label={t('artifact.saveAsAria')}
              className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {loading && !content ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-fg-muted">
          {t('artifact.loading')}
        </div>
      ) : content ? (
        <ArtifactView {...content} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center">
          {t('artifact.cannotPreview')}
        </div>
      )}
    </div>
  );
}

function transientRefFromSnapshot(
  snapshot: TransientArtifactSnapshot,
  sessionId: string | null,
): ArtifactRefT {
  const now = Date.now();
  const versions =
    snapshot.versions && snapshot.versions.length > 0
      ? snapshot.versions
      : [
          {
            v: snapshot.version ?? 1,
            ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
            ...(snapshot.content !== undefined ? { content: snapshot.content } : {}),
            ...(snapshot.path !== undefined ? { path: snapshot.path } : {}),
            ...(snapshot.fileSource !== undefined
              ? { fileSource: snapshot.fileSource }
              : snapshot.path !== undefined
                ? { fileSource: 'workspace' as const }
                : {}),
            ...(snapshot.deliveryId !== undefined ? { deliveryId: snapshot.deliveryId } : {}),
          },
        ];
  const version = snapshot.version ?? Math.max(...versions.map((v) => v.v));
  return {
    id: snapshot.id,
    sessionId: sessionId ?? '__transient__',
    surface: 'code',
    kind: snapshot.kind,
    title: snapshot.title,
    ...(snapshot.permissions !== undefined ? { permissions: snapshot.permissions } : {}),
    currentVersion: version,
    versions: versions.map((v) => ({
      v: v.v,
      createdAt: now + v.v,
      hasContent: v.content !== undefined,
      ...(v.path !== undefined ? { path: v.path } : {}),
      ...(v.path !== undefined ? { fileSource: 'workspace' as const } : {}),
      ...(v.summary !== undefined ? { summary: v.summary } : {}),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

function transientPayloadsFromSnapshot(
  snapshot: TransientArtifactSnapshot,
): ReadonlyMap<number, ArtifactVersionPayload> {
  const versions =
    snapshot.versions && snapshot.versions.length > 0
      ? snapshot.versions
      : [
          {
            v: snapshot.version ?? 1,
            ...(snapshot.content !== undefined ? { content: snapshot.content } : {}),
            ...(snapshot.path !== undefined ? { path: snapshot.path } : {}),
          },
        ];
  return new Map(
    versions.map((v) => [
      v.v,
      {
        ...(v.content !== undefined ? { content: v.content } : {}),
        ...(v.path !== undefined ? { path: v.path } : {}),
        ...(v.fileSource !== undefined
          ? { fileSource: v.fileSource }
          : snapshot.fileSource !== undefined
            ? { fileSource: snapshot.fileSource }
            : v.path !== undefined
              ? { fileSource: 'workspace' as const }
              : {}),
        ...(v.deliveryId !== undefined
          ? { deliveryId: v.deliveryId }
          : snapshot.deliveryId !== undefined
            ? { deliveryId: snapshot.deliveryId }
            : {}),
      },
    ]),
  );
}

function isFilePreviewSnapshot(snapshot: TransientArtifactSnapshot): boolean {
  return snapshot.source === 'file-preview' || snapshot.source === 'delivery-preview';
}

/**
 * @param focusedId 由宿主（RightSidebar）锁存的"要聚焦的 artifact id"。用于"从概览 tab 点
 *   对话卡片"场景：此组件当时还没挂载、错过 window 事件，靠这个 prop 在挂载时认领选中。
 *   其它已挂载实例（popout / Partner）仍靠 window 事件实时响应。
 */
export function ArtifactsView({
  focusedId,
  focusedSnapshot,
}: {
  focusedId?: string | null;
  focusedSnapshot?: TransientArtifactSnapshot | null;
} = {}): JSX.Element {
  const { t } = useI18n();
  const sessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const sessionProjectRoot = useAppStore((s) => {
    const cur = s.currentSessionId;
    return cur ? (s.sessions.find((x) => x.sessionId === cur)?.projectRoot ?? null) : null;
  });
  const projectRoot = sessionProjectRoot ?? currentProjectPath;
  const artifactSessionId = artifactSessionForProjectFiles(sessionId, projectRoot);
  const { artifacts, loading, error } = useArtifacts(artifactSessionId);
  const transcriptArtifacts = useTranscriptArtifacts(sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transientSnapshot, setTransientSnapshot] = useState<TransientArtifactSnapshot | null>(
    null,
  );

  // Reset selection when switching sessions (this view isn't remounted on switch).
  useEffect(() => {
    setSelectedId(null);
    setTransientSnapshot(null);
  }, [artifactSessionId]);

  // 宿主锁存的 focusedId（挂载时 / 变化时）→ 选中（修"从概览点卡片选不中"）。
  useEffect(() => {
    if (focusedId) setSelectedId(focusedId);
    if (focusedSnapshot) setTransientSnapshot(focusedSnapshot);
  }, [focusedId, focusedSnapshot]);

  // F059c: 对话里点 artifact 卡片 → 选中该 id（RightSidebar 同时把 tab 切到 Artifact）。
  // 给已挂载的实例（popout / Partner）实时响应；侧栏新挂载实例靠上面的 focusedId prop。
  useEffect(() => {
    const onFocus = (e: Event): void => {
      const detail = (e as CustomEvent<FocusArtifactEventDetail>).detail;
      const id = detail?.id;
      if (id) setSelectedId(id);
      setTransientSnapshot(detail?.snapshot ?? null);
    };
    window.addEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
  }, []);

  const transientArtifacts = useMemo(() => {
    const byId = new Map<string, TransientArtifactSnapshot>();
    for (const snapshot of transcriptArtifacts) byId.set(snapshot.id, snapshot);
    if (transientSnapshot) {
      const existing = byId.get(transientSnapshot.id);
      byId.set(
        transientSnapshot.id,
        existing ? mergeTransientArtifactSnapshots(existing, transientSnapshot) : transientSnapshot,
      );
    }
    return [...byId.values()];
  }, [transcriptArtifacts, transientSnapshot]);

  const listedTransientArtifacts = useMemo(
    () => transientArtifacts.filter((snapshot) => !isFilePreviewSnapshot(snapshot)),
    [transientArtifacts],
  );

  const transientRefs = useMemo(
    () => listedTransientArtifacts.map((snapshot) => transientRefFromSnapshot(snapshot, sessionId)),
    [listedTransientArtifacts, sessionId],
  );

  const artifactChoices = useMemo(() => {
    const storeIds = new Set(artifacts.map((artifact) => artifact.id));
    return [...artifacts, ...transientRefs.filter((artifact) => !storeIds.has(artifact.id))];
  }, [artifacts, transientRefs]);

  // Default selection = most recently updated store artifact, or recovered transcript artifact.
  const selectedFromStore =
    selectedId !== null
      ? (artifacts.find((a) => a.id === selectedId) ?? null)
      : (artifacts[0] ?? null);
  const selectedTransientSnapshot =
    selectedFromStore === null
      ? selectedId !== null
        ? (transientArtifacts.find((a) => a.id === selectedId) ?? null)
        : artifacts.length === 0
          ? (listedTransientArtifacts[0] ?? null)
          : null
      : null;
  const transientSelected = selectedTransientSnapshot
    ? transientRefFromSnapshot(selectedTransientSnapshot, sessionId)
    : null;
  const selected = selectedFromStore ?? transientSelected ?? artifacts[0] ?? null;
  const selectedPayloadOverrides = selectedTransientSnapshot
    ? transientPayloadsFromSnapshot(selectedTransientSnapshot)
    : undefined;
  const selectedIsFilePreview =
    selectedTransientSnapshot !== null && isFilePreviewSnapshot(selectedTransientSnapshot);

  if (artifacts.length === 0 && !selected) {
    if (!loading && error) return <ArtifactsErrorState error={error} />;
    return loading ? (
      <div className="h-full flex items-center justify-center text-[11px] text-fg-muted">
        {t('artifact.loading')}
      </div>
    ) : (
      <ArtifactsEmptyState />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col" data-testid="artifacts-view">
      {error && (
        <div
          className="px-3 py-1.5 border-b border-border-default text-[11px] text-danger flex-shrink-0 truncate"
          title={error}
        >
          {t('artifact.refreshFailed')}
        </div>
      )}
      {selectedIsFilePreview && selected && (
        <div
          data-testid="artifact-preview-title"
          className="flex flex-shrink-0 items-center gap-2 border-b border-border-default px-3 py-1.5 font-mono text-[11px] text-fg-muted"
        >
          <span className="min-w-0 flex-1 truncate" title={selected.title}>
            {selected.title}
          </span>
          {artifactChoices.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedId(artifactChoices[0]?.id ?? null)}
              className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
              title={t('right.openArtifactWorkspace')}
              aria-label={t('right.openArtifactWorkspace')}
            >
              <FileOutput className="h-3.5 w-3.5" strokeWidth={1.65} aria-hidden />
            </button>
          )}
        </div>
      )}
      {!selectedIsFilePreview && artifactChoices.length > 1 && (
        <div className="px-3 py-1.5 border-b border-border-default flex-shrink-0">
          <select
            data-testid="artifact-selector"
            className="w-full text-[11px] bg-surface-raised border border-border-default rounded px-1.5 py-1 text-fg-secondary"
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {artifactChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {selected ? (
        <ArtifactViewer
          key={selected.id}
          artifact={selected}
          projectRoot={projectRoot}
          payloadOverrides={selectedPayloadOverrides}
        />
      ) : (
        <ArtifactsEmptyState />
      )}
    </div>
  );
}

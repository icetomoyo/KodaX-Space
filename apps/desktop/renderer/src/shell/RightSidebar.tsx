// RightSidebar - F041 (v0.1.4) task mission control
//
// Before: Progress / Working folder / Context repeated the same todo state as PlanPanel.
// After: Run / Plan / Agents / Workflow / Changes / Sources / Artifacts / Context own task detail.
// StashNotice is retired; Changes owns file-level workspace status.
//
// Data sources:
//   - Run:      taskDockProjection from session/task/workflow/agent state
//   - Plan:     todoListBySession, same source as PlanPanel
//   - Agents:   Runtime Actor tree, with managed task status as the legacy fallback
//   - Changes:  project.gitChanges IPC, 200-file cap
//   - Working folder: currentProjectPath
//   - Context:  eventsBySession[sid].tool_start projection
//
// Section header buttons notify Shell to open or close the corresponding full detail surface.
//
// CommandToolbar no longer duplicates tasks/plan entry points. Diff / Preview / Terminal /
// Agents / MCP remain available where they own a separate workspace.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Bot,
  ChevronRight,
  Eye,
  Folder,
  FolderOpen,
  Loader2,
  Minus,
  RotateCcw,
  Send,
  Square,
  X,
} from 'lucide-react';
import type {
  ExternalAgentTaskEventT,
  ExternalAgentTaskT,
  SessionEvent,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import {
  openFileInViewer,
  revealPath,
  toProjectRelative,
  isAbsolutePathOutsideProject,
} from '../lib/openPath.js';
import { Caret } from '../components/Caret.js';
import { FileNameText } from '../components/FileNameText.js';
import { ArtifactsView } from '../features/artifact/ArtifactsView.js';
import { FileViewer } from '../features/preview/FileViewer.js';
import { useArtifacts, useArtifactCreated } from '../features/artifact/useArtifacts.js';
import { useTranscriptArtifacts } from '../features/artifact/useTranscriptArtifacts.js';
import {
  FOCUS_ARTIFACT_EVENT,
  OPEN_FILE_VIEWER_EVENT,
  getLastOpenedFileViewerSnapshot,
  isFileViewerSnapshot,
  type FocusArtifactEventDetail,
  type OpenFileViewerEventDetail,
  type TransientArtifactSnapshot,
} from '../features/artifact/transientArtifact.js';
import { WorkflowPanel, useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import {
  buildSidebarPlanView,
  type SidebarPlanRow,
  type SidebarTodoStatus,
} from './sidebarPlanView.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import { requestShellPopout } from './popoutControl.js';
import { FileActionMenu } from './FileActionMenu.js';
import type { PopoutKind } from './CommandToolbar.js';
import {
  isTaskDockSectionId,
  TASK_DOCK_FOCUS_EVENT,
  type TaskDockFocusState,
  type TaskDockFocusRequest,
  type TaskDockSectionId,
} from './taskDockControl.js';
import {
  buildAgentStatuses,
  scopeAgentActorSnapshotToCurrentTurn,
  type AgentStatusViewModel,
} from './agentStatusProjection.js';
import type { TaskDockRunViewModel } from './taskDockProjection.js';
import { useTaskDockRunView } from './useTaskDockRunView.js';
import { RightSidebarFrame, type RightSidebarWidthMode } from './RightSidebarFrame.js';
import { LearningSafetySection } from '../features/learning/LearningSafetySection.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const SECTION_OPEN_STORAGE_KEY = 'kodax-space.rightSidebar.sectionOpen';
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface FileMenuState {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly trigger: HTMLElement;
}

interface RightSidebarProps {
  /** Dynamic sidebar width in px. */
  readonly width?: number;
  readonly widthMode?: RightSidebarWidthMode;
  readonly onDefaultWidth?: () => void;
  readonly onHalfWidth?: () => void;
  readonly onMaxWidth?: () => void;
  readonly onClose?: () => void;
  readonly shellFocusRequest?: TaskDockFocusState;
}

export function RightSidebar({
  width,
  widthMode = 'custom',
  onDefaultWidth,
  onHalfWidth,
  onMaxWidth,
  onClose,
  shellFocusRequest,
}: RightSidebarProps = {}): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const { artifacts, error: artifactError } = useArtifacts(currentSessionId);
  const transcriptArtifacts = useTranscriptArtifacts(currentSessionId);
  const hasArtifacts = artifacts.length > 0;
  const hasTranscriptArtifacts = transcriptArtifacts.length > 0;
  const artifactCount = hasArtifacts ? artifacts.length : transcriptArtifacts.length;
  const [tab, setTab] = useState<'overview' | 'artifact' | 'file'>('overview');
  const [focusedArtifactSnapshot, setFocusedArtifactSnapshot] =
    useState<TransientArtifactSnapshot | null>(null);
  const [fileViewerSnapshot, setFileViewerSnapshot] = useState<TransientArtifactSnapshot | null>(
    null,
  );
  const hasArtifactSurface =
    currentSessionId !== null &&
    (hasArtifacts || hasTranscriptArtifacts || artifactError !== null || tab === 'artifact');
  const hasFileViewerSurface = fileViewerSnapshot !== null;
  // Latch the artifact id selected from the transcript so ArtifactsView can claim it
  // after switching from overview to artifact mode.
  const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<TaskDockFocusState>({
    section: null,
    nonce: 0,
  });

  useEffect(() => {
    const onFocus = (event: Event): void => {
      const section = (event as CustomEvent<TaskDockFocusRequest>).detail?.section;
      if (!isTaskDockSectionId(section)) return;
      setTab(section === 'artifacts' ? 'artifact' : 'overview');
      setFocusRequest((current) => ({ section, nonce: current.nonce + 1 }));
    };
    window.addEventListener(TASK_DOCK_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(TASK_DOCK_FOCUS_EVENT, onFocus);
  }, []);

  const effectiveFocusRequest =
    shellFocusRequest && shellFocusRequest.nonce > focusRequest.nonce
      ? shellFocusRequest
      : focusRequest;

  // Artifact focus is Session-scoped. Workspace File Viewer entries remain open across
  // Session changes, while Session attachment previews are cleared with their owner.
  useEffect(() => {
    setTab((current) => (current === 'artifact' ? 'overview' : current));
    setFocusedArtifactId(null);
    setFocusedArtifactSnapshot(null);
  }, [currentSessionId]);
  useEffect(() => {
    if (
      fileViewerSnapshot?.source !== 'session-attachment-preview' ||
      fileViewerSnapshot.sessionId === currentSessionId
    ) {
      return;
    }
    setFileViewerSnapshot(null);
    setTab((current) => (current === 'file' ? 'overview' : current));
  }, [currentSessionId, fileViewerSnapshot]);
  useEffect(() => {
    setTab((current) => (current === 'file' ? 'overview' : current));
    setFileViewerSnapshot(null);
  }, [currentProjectPath]);
  useEffect(() => {
    if (!hasArtifacts && hasTranscriptArtifacts) setTab('artifact');
  }, [hasArtifacts, hasTranscriptArtifacts, currentSessionId]);
  // New agent-created artifact: switch to Artifact mode. Updates, deletes, and session switches
  // should not trigger this path.
  useArtifactCreated(currentSessionId, () => setTab('artifact'));
  // Transcript artifact card click: switch to Artifact mode and remember the target id.
  useEffect(() => {
    const onFocus = (e: Event): void => {
      setTab('artifact');
      const detail = (e as CustomEvent<FocusArtifactEventDetail>).detail;
      if (isFileViewerSnapshot(detail?.snapshot)) {
        setFileViewerSnapshot(detail.snapshot ?? null);
        setTab('file');
        return;
      }
      const id = detail?.id;
      if (id) setFocusedArtifactId(id);
      setFocusedArtifactSnapshot(detail?.snapshot ?? null);
    };
    window.addEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
  }, []);
  useEffect(() => {
    const onOpenFile = (event: Event): void => {
      const detail = (event as CustomEvent<OpenFileViewerEventDetail>).detail;
      if (!isFileViewerSnapshot(detail?.snapshot)) return;
      setFileViewerSnapshot(detail.snapshot);
      setTab('file');
    };
    window.addEventListener(OPEN_FILE_VIEWER_EVENT, onOpenFile);
    return () => window.removeEventListener(OPEN_FILE_VIEWER_EVENT, onOpenFile);
  }, []);
  useEffect(() => {
    const snapshot = getLastOpenedFileViewerSnapshot(currentProjectPath, currentSessionId);
    if (!snapshot) return;
    setFileViewerSnapshot(snapshot);
    setTab('file');
  }, [currentProjectPath, currentSessionId]);

  // If artifacts disappear, overview is the safe fallback.
  const showArtifact = hasArtifactSurface && tab === 'artifact';
  const showFileViewer = hasFileViewerSurface && tab === 'file';

  return (
    <RightSidebarFrame
      width={width}
      widthMode={widthMode}
      onDefaultWidth={onDefaultWidth}
      onHalfWidth={onHalfWidth}
      onMaxWidth={onMaxWidth}
      onClose={onClose}
    >
      {/* F059c: when artifacts exist, expose Overview / Artifact tabs. Artifact mode owns
          the full sidebar height instead of being squeezed into a small bottom box. */}
      {(hasArtifactSurface || hasFileViewerSurface) && (
        <div className="flex items-stretch border-b border-border-default flex-shrink-0">
          <SidebarTab
            active={!showArtifact && !showFileViewer}
            onClick={() => setTab('overview')}
            testId="right-sidebar-tab-overview"
          >
            {t('right.overview')}
          </SidebarTab>
          {hasArtifactSurface && (
            <SidebarTab
              active={showArtifact}
              onClick={() => setTab('artifact')}
              testId="right-sidebar-tab-artifact"
            >
              {t('right.artifact')}{' '}
              {artifactCount > 0 ? `(${artifactCount})` : artifactError ? '(!)' : ''}
            </SidebarTab>
          )}
          {hasFileViewerSurface && (
            <SidebarTab
              active={showFileViewer}
              onClick={() => setTab('file')}
              testId="right-sidebar-tab-file"
            >
              {t('right.fileViewer')}
            </SidebarTab>
          )}
        </div>
      )}
      {showFileViewer && fileViewerSnapshot ? (
        <div className="flex-1 min-h-0">
          <FileViewer snapshot={fileViewerSnapshot} onSnapshotChange={setFileViewerSnapshot} />
        </div>
      ) : showArtifact ? (
        <div className="flex-1 min-h-0">
          <ArtifactsView focusedId={focusedArtifactId} focusedSnapshot={focusedArtifactSnapshot} />
        </div>
      ) : (
        // Overview: stacked task sections with local scrolling.
        <div className="flex-1 min-h-0 overflow-y-auto">
          <RunSection focusRequest={effectiveFocusRequest} />
          <LearningSafetySection />
          <PlanSection focusRequest={effectiveFocusRequest} />
          <AgentSection focusRequest={effectiveFocusRequest} />
          <ExternalAgentTasksSection />
          <WorkflowSection focusRequest={effectiveFocusRequest} />
          <ChangesSection focusRequest={effectiveFocusRequest} />
          <SourcesSection focusRequest={effectiveFocusRequest} />
          <ArtifactsSummarySection
            focusRequest={effectiveFocusRequest}
            artifactCount={artifactCount}
            hasArtifactSurface={hasArtifactSurface}
            artifactError={artifactError}
            onOpenArtifact={() => setTab('artifact')}
          />
          <ContextSection focusRequest={effectiveFocusRequest} />
        </div>
      )}
    </RightSidebarFrame>
  );
}

/** Segmented tab button for the right sidebar top switcher. */
function SidebarTab({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`flex-1 px-3 py-2 text-[12px] font-medium ${
        active ? 'text-fg-primary bg-surface-2' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {children}
    </button>
  );
}

// ---- Section container ----

interface SectionProps {
  title: string;
  sectionId?: TaskDockSectionId;
  focusRequest?: TaskDockFocusState;
  defaultOpen?: boolean;
  autoOpenKey?: string | number | null;
  /** When set, the header shows a full-detail button that toggles the matching popout. */
  popoutKind?: PopoutKind;
  children: React.ReactNode;
}

function readSectionOpenState(): Partial<Record<TaskDockSectionId, boolean>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SECTION_OPEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: Partial<Record<TaskDockSectionId, boolean>> = {};
    for (const key of Object.keys(parsed)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key as TaskDockSectionId] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function readSectionOpen(sectionId: TaskDockSectionId | undefined, defaultOpen: boolean): boolean {
  if (!sectionId) return defaultOpen;
  return readSectionOpenState()[sectionId] ?? defaultOpen;
}

function writeSectionOpen(sectionId: TaskDockSectionId | undefined, open: boolean): void {
  if (!sectionId || typeof window === 'undefined') return;
  try {
    const next = { ...readSectionOpenState(), [sectionId]: open };
    window.localStorage.setItem(SECTION_OPEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore private-mode/storage failures; the in-memory state still updates.
  }
}

function Section({
  title,
  sectionId,
  focusRequest,
  defaultOpen = true,
  autoOpenKey = null,
  popoutKind,
  children,
}: SectionProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpenState] = useState(() => readSectionOpen(sectionId, defaultOpen));
  const ref = useRef<HTMLElement | null>(null);
  const lastAutoOpenKeyRef = useRef<string | number | null>(null);
  // Toggle behavior: if this popout is already active, the button closes it.
  const activePopoutKind = useAppStore((s) => s.activePopoutKind);
  const isThisPopoutActive = popoutKind !== undefined && activePopoutKind === popoutKind;
  const setOpen = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      setOpenState((previous) => {
        const value = typeof next === 'function' ? next(previous) : next;
        writeSectionOpen(sectionId, value);
        return value;
      });
    },
    [sectionId],
  );

  useEffect(() => {
    if (!sectionId || focusRequest?.section !== sectionId) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest?.nonce, focusRequest?.section, sectionId, setOpen]);

  useEffect(() => {
    if (autoOpenKey === null || autoOpenKey === lastAutoOpenKeyRef.current) return;
    lastAutoOpenKeyRef.current = autoOpenKey;
    setOpen(true);
  }, [autoOpenKey, setOpen]);

  return (
    <section
      ref={ref}
      className="border-b border-border-default/60"
      data-testid={popoutKind ? `right-sidebar-section-${popoutKind}` : undefined}
      data-task-dock-section={sectionId}
    >
      <div
        className="flex min-h-8 w-full items-stretch text-xs uppercase tracking-wider text-fg-muted"
        data-testid="task-dock-section-header"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center px-3 py-2 text-left hover:bg-hover-bg hover:text-fg-primary"
          aria-expanded={open}
          data-testid="task-dock-section-toggle"
        >
          <span className="truncate">{title}</span>
        </button>
        {/* Keep every visible control at least 28px tall; the title trigger owns the rest of the row. */}
        <div className="flex items-center gap-0.5 px-1.5">
          {popoutKind && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isThisPopoutActive) {
                  requestShellPopout(null);
                } else {
                  requestShellPopout(popoutKind);
                }
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
              title={isThisPopoutActive ? t('right.closePopout') : t('right.openFullPanel')}
              aria-label={isThisPopoutActive ? t('right.closePopout') : t('right.openFullPanel')}
              aria-pressed={isThisPopoutActive}
            >
              {isThisPopoutActive ? (
                // X icon (close)
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              ) : (
                // Expand-corner icon (popout)
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
            title={open ? t('right.collapseSection') : t('right.expandSection')}
            aria-label={open ? t('right.collapseSection') : t('right.expandSection')}
            aria-expanded={open}
          >
            {/* Shared caret: collapsed points right, expanded points down. */}
            <Caret open={open} />
          </button>
        </div>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ---- Plan section ----

function RunSection({ focusRequest }: { readonly focusRequest: TaskDockFocusState }): JSX.Element {
  const { t } = useI18n();
  const { view } = useTaskDockRunView();

  return (
    <Section title={t('right.run')} sectionId="run" focusRequest={focusRequest}>
      <div
        className={`rounded-lg border px-2.5 py-2 ${runCardClass(view.severity)}`}
        data-testid="task-dock-run-summary"
      >
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 rounded-full ${runDotClass(view.severity)}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg-primary" title={view.headline}>
              {view.headline}
            </div>
            {view.detail && (
              <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-fg-muted">
                {view.detail}
              </div>
            )}
          </div>
        </div>
        {view.metrics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {view.metrics.map((metric) => (
              <span
                key={metric.key}
                className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-secondary"
              >
                <span className="text-fg-faint">{metric.label}</span>{' '}
                <span className="font-mono text-fg-primary">{metric.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function runCardClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'border-run/40 bg-run/10';
    case 'warning':
      return 'border-warn/40 bg-warn/10';
    case 'danger':
      return 'border-danger/40 bg-danger/10';
    case 'success':
      return 'border-ok/40 bg-ok/10';
    case 'info':
      return 'border-border-default bg-surface-2';
    case 'neutral':
      return 'border-border-default bg-surface-2';
  }
}

function runDotClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'bg-run animate-pulse';
    case 'warning':
      return 'bg-warn';
    case 'danger':
      return 'bg-danger';
    case 'success':
      return 'bg-ok';
    case 'info':
      return 'bg-accent-ink';
    case 'neutral':
      return 'bg-fg-faint';
  }
}

function PlanSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [expandedPlanSessionId, setExpandedPlanSessionId] = useState<string | null>(null);
  const todos = useAppStore((s) =>
    currentSessionId
      ? (s.liveProjectionBySession[currentSessionId]?.todos ??
        s.todoListBySession[currentSessionId])
      : undefined,
  );
  const showAll = currentSessionId !== null && expandedPlanSessionId === currentSessionId;
  const showAllPlanItems = useCallback(() => {
    if (currentSessionId) setExpandedPlanSessionId(currentSessionId);
  }, [currentSessionId]);

  if (!todos || todos.length === 0) return null;

  const plan = buildSidebarPlanView(todos, { expanded: showAll });

  return (
    <Section
      title={`${t('right.plan')} (${plan.completed}/${plan.total})`}
      sectionId="plan"
      focusRequest={focusRequest}
      popoutKind="plan"
    >
      {plan.running?.activeForm && (
        <div className="text-xs text-fg-muted mb-2 truncate" title={plan.running.activeForm}>
          {t('right.now')}: {plan.running.activeForm}
        </div>
      )}
      <ul className="space-y-1 text-xs">
        {plan.rows.map((row) => (
          <PlanRow key={planRowKey(row)} row={row} onShowAll={showAllPlanItems} />
        ))}
      </ul>
    </Section>
  );
}

function planRowKey(row: SidebarPlanRow): string {
  if (row.kind === 'item') return row.item.id;
  return `${row.kind}:${row.count}`;
}

function PlanRow({ row, onShowAll }: { row: SidebarPlanRow; onShowAll: () => void }): JSX.Element {
  const { t } = useI18n();
  if (row.kind === 'done-summary') {
    return (
      <li className="flex items-center gap-2 px-1.5 py-0.5 text-[11px] font-mono text-fg-faint">
        <span className="w-3 text-center text-ok" aria-hidden>
          <Check className="inline h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span>{t('right.doneCount', { count: row.count })}</span>
      </li>
    );
  }

  if (row.kind === 'more-summary') {
    const label = t('right.showMorePlanItems', { count: row.count });
    return (
      <li>
        <button
          type="button"
          onClick={onShowAll}
          className="group flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[11px] text-fg-faint hover:bg-hover-bg hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
          aria-label={label}
          title={label}
          data-testid="right-sidebar-plan-show-more"
        >
          <span className="w-3 text-center" aria-hidden>
            +
          </span>
          <span className="underline-offset-2 group-hover:underline">
            {t('right.moreCount', { count: row.count })}
          </span>
        </button>
      </li>
    );
  }

  const { item } = row;
  return (
    <li
      className={`flex items-start gap-2 rounded px-1.5 py-1 ${
        item.status === 'in_progress' ? 'bg-run/25' : ''
      }`}
    >
      <span
        className="flex-shrink-0 mt-0.5"
        title={item.status}
        aria-label={t('right.statusAria', { status: item.status })}
      >
        <PlanStatusIcon status={item.status} />
      </span>
      <span
        className={`min-w-0 flex-1 leading-snug break-words ${planTodoTextClass(item.status)}`}
        title={item.content}
      >
        {item.content}
      </span>
    </li>
  );
}

function PlanStatusIcon({ status }: { status: SidebarTodoStatus }): JSX.Element {
  switch (status) {
    case 'completed':
      return <CircleDone tiny />;
    case 'in_progress':
      return <CircleActive tiny />;
    case 'failed':
      return <CircleFailed tiny />;
    case 'skipped':
    case 'cancelled':
      return <CircleMuted tiny />;
    case 'pending':
      return <CircleEmpty tiny />;
  }
}

function planTodoTextClass(status: SidebarTodoStatus): string {
  switch (status) {
    case 'completed':
      return 'text-fg-muted';
    case 'in_progress':
      return 'text-fg-primary font-medium';
    case 'failed':
      return 'text-danger font-medium';
    case 'skipped':
    case 'cancelled':
      return 'text-fg-muted line-through';
    case 'pending':
      return 'text-fg-secondary';
  }
}

// ---- Agents and workflow sections ----

// F061 workflow progress section. RightSidebar is mounted only for the code surface.
// Hide when there are no runs for this session. When a run just finished, keep the
// latest terminal run visible so the user can review the workflow result.
function WorkflowSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const runs = useSessionWorkflowRuns();
  // If a retry starts after a workflow failure, show active runs only. Otherwise the
  // previous failed run and current run look mixed together in the compact sidebar.
  // When no run is active, keep the latest terminal run so the section does not
  // disappear before the user can inspect the result.
  //
  // Runs are already sorted newest-first; [0] is the latest run.

  const displayRuns = useMemo(() => {
    const active = runs.filter((run) => run.status === 'running' || run.status === 'paused');
    return active.length > 0 ? active : runs.slice(0, 1);
  }, [runs]);
  if (displayRuns.length === 0) return null;
  const title =
    displayRuns.length > 1 ? `${t('right.workflow')} (${displayRuns.length})` : t('right.workflow');
  return (
    <Section title={title} sectionId="workflow" focusRequest={focusRequest} popoutKind="workflow">
      <WorkflowPanel runs={displayRuns} variant="compact" />
    </Section>
  );
}

function AgentSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const actorSnapshot = useAppStore((s) =>
    currentSessionId ? s.agentActorSnapshotBySession[currentSessionId] : undefined,
  );
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );

  const currentTurnActorSnapshot = useMemo(
    () => scopeAgentActorSnapshotToCurrentTurn(actorSnapshot, events),
    [actorSnapshot, events],
  );
  const agents = useMemo(
    () => buildAgentStatuses(status, t, currentTurnActorSnapshot),
    [currentTurnActorSnapshot, status, t],
  );

  // Hide empty agent content, matching the no-content strategy used by PlanSection.
  if (agents.length === 0 && !budget) return null;

  // active = workers that are actually moving now; idle/done should not dominate summary.
  const runningCount = agents.filter((agent) => agent.state === 'active').length;
  const waitingCount = agents.filter((agent) => agent.state === 'waiting').length;
  const completedCount = agents.filter((agent) => agent.state === 'completed').length;
  const interruptedCount = agents.filter((agent) => agent.state === 'interrupted').length;
  const activeAgentKey = agents
    .filter((agent) => agent.state === 'active')
    .map((agent) => agent.id)
    .join('|');
  // #7 fix: empty active workers does not always mean idle. idleWaiting, child fan-out,
  // and budget approval are still in-progress states, even before worker-tree has
  // concrete active cards. Mirror TasksPanel ordering so compact status is not blank.

  const fanoutLabel =
    !actorSnapshot && status?.childFanoutCount !== undefined && status.childFanoutCount > 0
      ? status.childFanoutClass
        ? t('right.agentFanoutWithClass', {
            count: status.childFanoutCount,
            className: status.childFanoutClass,
          })
        : t('right.agentFanout', { count: status.childFanoutCount })
      : null;

  return (
    <Section
      title={t('right.agentsCount', { count: agents.length })}
      sectionId="agents"
      focusRequest={focusRequest}
      defaultOpen={runningCount > 0}
      autoOpenKey={activeAgentKey || null}
      popoutKind="tasks"
    >
      {budget && (
        <div className="mb-2 text-[11px]">
          <div className="text-fg-secondary font-mono">
            {t('right.budget')} {budget.used}/{budget.cap}
            {status?.budgetApprovalRequired && (
              <span className="ml-2 text-warn">/ {t('right.approvalNeeded')}</span>
            )}
          </div>
          <div className="h-1 bg-surface-3 rounded overflow-hidden mt-0.5">
            <div
              className="h-full bg-ok"
              style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {runningCount > 0 && <AgentMetric label={t('right.running')} value={runningCount} />}
          {waitingCount > 0 && <AgentMetric label={t('right.waiting')} value={waitingCount} />}
          {completedCount > 0 && <AgentMetric label={t('right.done')} value={completedCount} />}
          {interruptedCount > 0 && (
            <AgentMetric label={t('right.interrupted')} value={interruptedCount} />
          )}
          {fanoutLabel && <AgentMetric label={t('right.fanout')} value={fanoutLabel} />}
        </div>
      )}
      {agents.length === 0 ? (
        status?.idleWaiting ? (
          <div className="text-xs text-fg-muted">
            {t('right.waitingPending', { count: status.idleWaitingPendingCount ?? 0 })}
          </div>
        ) : fanoutLabel ? (
          <div className="text-xs text-fg-muted">{fanoutLabel}</div>
        ) : status?.budgetApprovalRequired ? (
          <div className="text-xs text-warn">{t('right.budgetApprovalNeeded')}</div>
        ) : (
          <div className="text-xs text-fg-muted">{t('right.noDelegatedAgents')}</div>
        )
      ) : (
        <AgentInlineList agents={agents} />
      )}
    </Section>
  );
}

function ExternalAgentTasksSection(): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [tasks, setTasks] = useState<ExternalAgentTaskT[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [inputByTask, setInputByTask] = useState<Record<string, string>>({});
  const [eventsByTask, setEventsByTask] = useState<Record<string, ExternalAgentTaskEventT[]>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const activeSessionRef = useRef(currentSessionId);
  activeSessionRef.current = currentSessionId;

  const refresh = useCallback(async (): Promise<ExternalAgentTaskT[] | null> => {
    const sessionId = currentSessionId;
    if (!window.kodaxSpace || !sessionId) return [];
    const result = await window.kodaxSpace.invoke('agent.external.task.list', {
      sessionId,
    });
    if (activeSessionRef.current !== sessionId) return null;
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    setError(null);
    setTasks(result.data.tasks);
    return result.data.tasks;
  }, [currentSessionId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    setTasks([]);
    setError(null);
    setEventsByTask({});
    setExpandedTaskId(null);
    setBusyTaskId(null);
    setInputByTask({});
    if (!currentSessionId) return () => undefined;

    const poll = async (): Promise<void> => {
      const nextTasks = await refresh();
      if (cancelled || activeSessionRef.current !== currentSessionId) return;
      const hasActiveTasks =
        nextTasks?.some((task) => !isExternalTaskTerminal(task.state)) ?? false;
      const delayMs = document.hidden ? 10_000 : hasActiveTasks ? 1_500 : 5_000;
      timer = window.setTimeout(() => void poll(), delayMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [currentSessionId, refresh]);

  const loadEvents = useCallback(
    async (
      taskId: string,
      sessionId = currentSessionId,
    ): Promise<ExternalAgentTaskEventT[] | null> => {
      if (!window.kodaxSpace || !sessionId) return null;
      const events: ExternalAgentTaskEventT[] = [];
      let cursor = 0;
      for (let page = 0; page < 8; page += 1) {
        const result = await window.kodaxSpace.invoke('agent.external.task.events', {
          sessionId,
          taskId,
          cursor,
        });
        if (activeSessionRef.current !== sessionId) return null;
        if (!result.ok) {
          setError(result.error.message);
          return null;
        }
        events.push(...result.data.events);
        if (result.data.events.length < 512 || result.data.nextCursor <= cursor) break;
        cursor = result.data.nextCursor;
      }
      setEventsByTask((current) => ({ ...current, [taskId]: events }));
      return events;
    },
    [currentSessionId],
  );

  const expandedTask = tasks.find((task) => task.taskId === expandedTaskId);
  const expandedTaskUpdatedAt = expandedTask?.updatedAt ?? null;
  const expandedTaskState = expandedTask?.state ?? null;
  useEffect(() => {
    if (!expandedTaskId || !currentSessionId || !expandedTaskUpdatedAt || !expandedTaskState) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const refreshAudit = async (attempt: number): Promise<void> => {
      const events = await loadEvents(expandedTaskId, currentSessionId);
      if (cancelled || !events || !isExternalTaskTerminal(expandedTaskState)) return;
      const hasTerminalEvent = events.some((event) => event.state === expandedTaskState);
      if (hasTerminalEvent || attempt >= 7) return;
      const delayMs = Math.min(250 * 2 ** attempt, 2_000);
      timer = window.setTimeout(() => void refreshAudit(attempt + 1), delayMs);
    };
    void refreshAudit(0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [currentSessionId, expandedTaskId, expandedTaskState, expandedTaskUpdatedAt, loadEvents]);

  async function toggleDetails(taskId: string): Promise<void> {
    const next = expandedTaskId === taskId ? null : taskId;
    setExpandedTaskId(next);
    if (next) await loadEvents(taskId);
  }

  async function sendInput(taskId: string): Promise<void> {
    const content = inputByTask[taskId]?.trim();
    const sessionId = currentSessionId;
    if (!window.kodaxSpace || !content || !sessionId) return;
    setBusyTaskId(taskId);
    const result = await window.kodaxSpace.invoke('agent.external.task.sendInput', {
      sessionId,
      taskId,
      content,
    });
    if (activeSessionRef.current !== sessionId) return;
    setBusyTaskId(null);
    if (!result.ok) setError(result.error.message);
    else {
      setInputByTask((current) => ({ ...current, [taskId]: '' }));
      await Promise.all([refresh(), loadEvents(taskId, sessionId)]);
    }
  }

  async function cancelTask(taskId: string): Promise<void> {
    const sessionId = currentSessionId;
    if (!window.kodaxSpace || !sessionId) return;
    setBusyTaskId(taskId);
    const result = await window.kodaxSpace.invoke('agent.external.task.cancel', {
      sessionId,
      taskId,
      reason: t('right.externalAgentCancelReason'),
    });
    if (activeSessionRef.current !== sessionId) return;
    setBusyTaskId(null);
    if (!result.ok) setError(result.error.message);
    else await Promise.all([refresh(), loadEvents(taskId, sessionId)]);
  }

  async function reconcileTask(taskId: string): Promise<void> {
    const sessionId = currentSessionId;
    if (!window.kodaxSpace || !sessionId) return;
    setBusyTaskId(taskId);
    const result = await window.kodaxSpace.invoke('agent.external.task.reconcile', {
      sessionId,
      taskId,
    });
    if (activeSessionRef.current !== sessionId) return;
    setBusyTaskId(null);
    if (!result.ok) setError(result.error.message);
    else await Promise.all([refresh(), loadEvents(taskId, sessionId)]);
  }

  if (tasks.length === 0 && !error) return null;
  const activeCount = tasks.filter((task) => !isExternalTaskTerminal(task.state)).length;
  return (
    <Section
      title={t('right.externalAgentTasksCount', { count: tasks.length })}
      defaultOpen={activeCount > 0}
      autoOpenKey={tasks.find((task) => !isExternalTaskTerminal(task.state))?.taskId ?? null}
    >
      {error && <div className="mb-2 text-[11px] text-danger">{error}</div>}
      <div className="space-y-2" data-testid="external-agent-task-list">
        {tasks.map((task) => {
          const expanded = expandedTaskId === task.taskId;
          const busy = busyTaskId === task.taskId;
          const canCancel = ['submitted', 'working', 'input-required', 'auth-required'].includes(
            task.state,
          );
          return (
            <article
              key={task.taskId}
              className={`rounded-lg border px-2.5 py-2 ${externalTaskCardClass(task.state)}`}
              data-testid="external-agent-task-card"
            >
              <button
                type="button"
                onClick={() => void toggleDetails(task.taskId)}
                className="w-full text-left"
                aria-expanded={expanded}
              >
                <div className="flex items-start gap-2">
                  <Bot size={13} className="mt-0.5 shrink-0 text-info" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="line-clamp-2 text-[11px] font-medium text-fg-primary">
                        {task.objective}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[9px] uppercase text-fg-secondary">
                        {externalTaskStateLabel(task.state, t)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9px] text-fg-faint">
                      {task.agentId}
                    </div>
                    {task.progress?.message && (
                      <div className="mt-1 text-[10px] text-fg-secondary">
                        {task.progress.message}
                      </div>
                    )}
                    {task.progress?.percent !== undefined && (
                      <div className="mt-1 h-1 overflow-hidden rounded bg-surface-3">
                        <div
                          className="h-full bg-info"
                          style={{ width: `${task.progress.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {task.cancellation !== 'none' && (
                <div className="mt-1.5 rounded bg-warn/10 px-2 py-1 text-[10px] text-warn">
                  {t('right.externalAgentCancellation', {
                    state: externalCancellationLabel(task.cancellation, t),
                  })}
                </div>
              )}

              {task.state === 'input-required' && (
                <div className="mt-2 flex gap-1.5" data-testid="external-agent-input-form">
                  <input
                    value={inputByTask[task.taskId] ?? ''}
                    onChange={(event) =>
                      setInputByTask((current) => ({
                        ...current,
                        [task.taskId]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void sendInput(task.taskId);
                    }}
                    placeholder={t('right.externalAgentInputPlaceholder')}
                    className="min-w-0 flex-1 rounded border border-warn/40 bg-surface px-2 py-1 text-[11px] text-fg-primary outline-none focus:border-warn"
                  />
                  <button
                    type="button"
                    disabled={busy || !inputByTask[task.taskId]?.trim()}
                    onClick={() => void sendInput(task.taskId)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded bg-warn/15 text-warn disabled:opacity-50"
                    aria-label={t('right.externalAgentSendInput')}
                    title={t('right.externalAgentSendInput')}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
              )}

              {task.state === 'auth-required' && (
                <div className="mt-2 rounded bg-danger/10 px-2 py-1 text-[10px] text-danger">
                  {t('right.externalAgentAuthRequired')}
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {canCancel && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelTask(task.taskId)}
                    className="inline-flex min-h-6 items-center gap-1 rounded border border-danger/35 bg-danger/10 px-2 text-[10px] text-danger disabled:opacity-50"
                  >
                    <Square size={9} /> {t('right.externalAgentCancel')}
                  </button>
                )}
                {task.state === 'unknown' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reconcileTask(task.taskId)}
                    className="inline-flex min-h-6 items-center gap-1 rounded border border-warn/35 bg-warn/10 px-2 text-[10px] text-warn disabled:opacity-50"
                  >
                    <RotateCcw size={10} className={busy ? 'animate-spin' : ''} />{' '}
                    {t('right.externalAgentReconcile')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void toggleDetails(task.taskId)}
                  className="ml-auto text-[10px] text-fg-muted hover:text-fg-primary"
                >
                  {expanded
                    ? t('right.externalAgentHideDetails')
                    : t('right.externalAgentShowDetails')}
                </button>
              </div>

              {expanded && (
                <div
                  className="mt-2 space-y-2 border-t border-border-default/60 pt-2"
                  data-testid="external-agent-task-details"
                >
                  <div className="grid grid-cols-2 gap-1 text-[9px] text-fg-faint">
                    <span>
                      {t('right.externalAgentProtocol')}: {task.protocol}
                    </span>
                    <span className="break-all">
                      {t('right.externalAgentRevision')}: {task.configurationRevision}
                    </span>
                    {task.runId && (
                      <span>
                        {t('right.externalAgentRun')}: {task.runId}
                      </span>
                    )}
                    <span>{new Date(task.updatedAt).toLocaleString()}</span>
                  </div>
                  {task.output && (
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-3 p-2 text-[10px] text-fg-secondary">
                      {task.output}
                    </pre>
                  )}
                  {(task.error ?? task.cancellationError) && (
                    <div className="rounded bg-danger/10 p-2 text-[10px] text-danger">
                      {task.error ?? task.cancellationError}
                    </div>
                  )}
                  {task.artifacts && task.artifacts.length > 0 && (
                    <div className="text-[10px] text-fg-secondary">
                      {t('right.externalAgentArtifacts', { count: task.artifacts.length })}
                    </div>
                  )}
                  {task.usage?.totalTokens !== undefined && (
                    <div className="text-[10px] text-fg-muted">
                      {t('right.externalAgentTokens', { count: task.usage.totalTokens })}
                    </div>
                  )}
                  <ExternalAgentEventTimeline
                    events={projectExternalAgentAudit(task, eventsByTask[task.taskId] ?? [])}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Section>
  );
}

function ExternalAgentEventTimeline({
  events,
}: {
  readonly events: readonly ExternalAgentTaskEventT[];
}): JSX.Element {
  const { t } = useI18n();
  if (events.length === 0)
    return <div className="text-[10px] text-fg-faint">{t('right.externalAgentNoEvents')}</div>;
  return (
    <ol className="space-y-1" aria-label={t('right.externalAgentEventLog')}>
      {events.map((event) => (
        <li
          key={`${event.taskId}:${event.seq}:${event.type}`}
          className="flex gap-2 text-[10px] text-fg-muted"
        >
          <span className="w-5 shrink-0 font-mono text-fg-faint">#{event.seq}</span>
          <span className="w-16 shrink-0 text-fg-secondary">{event.type}</span>
          <span className="min-w-0 break-words">
            {event.progress?.message ??
              event.output ??
              event.error ??
              (event.state ? externalTaskStateLabel(event.state, t) : '')}
          </span>
        </li>
      ))}
    </ol>
  );
}

function projectExternalAgentAudit(
  task: ExternalAgentTaskT,
  events: readonly ExternalAgentTaskEventT[],
): readonly ExternalAgentTaskEventT[] {
  if (
    !isExternalTaskTerminal(task.state) ||
    events.some((event) => event.type === 'state' && event.state === task.state)
  ) {
    return events;
  }
  // The durable task snapshot is authoritative even when KodaX 0.7.74 writes
  // its terminal snapshot immediately after output without a final state event.
  return [
    ...events,
    {
      taskId: task.taskId,
      seq: events.reduce((next, event) => Math.max(next, event.seq), 0) + 1,
      timestamp: task.updatedAt,
      type: 'state',
      state: task.state,
    },
  ];
}

function isExternalTaskTerminal(state: ExternalAgentTaskT['state']): boolean {
  return ['completed', 'failed', 'canceled', 'rejected'].includes(state);
}

function externalTaskCardClass(state: ExternalAgentTaskT['state']): string {
  if (state === 'completed') return 'border-ok/35 bg-ok/8';
  if (state === 'failed' || state === 'rejected') return 'border-danger/40 bg-danger/8';
  if (state === 'input-required' || state === 'auth-required' || state === 'unknown')
    return 'border-warn/40 bg-warn/8';
  if (state === 'canceled') return 'border-border-default bg-surface-2';
  return 'border-info/35 bg-info/8';
}

function externalTaskStateLabel(state: ExternalAgentTaskT['state'], t: Translate): string {
  switch (state) {
    case 'submitted':
      return t('right.externalAgentState.submitted');
    case 'working':
      return t('right.externalAgentState.working');
    case 'input-required':
      return t('right.externalAgentState.inputRequired');
    case 'auth-required':
      return t('right.externalAgentState.authRequired');
    case 'completed':
      return t('right.externalAgentState.completed');
    case 'failed':
      return t('right.externalAgentState.failed');
    case 'canceled':
      return t('right.externalAgentState.canceled');
    case 'rejected':
      return t('right.externalAgentState.rejected');
    case 'unknown':
      return t('right.externalAgentState.unknown');
  }
}

function externalCancellationLabel(
  cancellation: ExternalAgentTaskT['cancellation'],
  t: Translate,
): string {
  switch (cancellation) {
    case 'none':
      return t('right.externalAgentCancellationState.none');
    case 'requested':
      return t('right.externalAgentCancellationState.requested');
    case 'confirmed':
      return t('right.externalAgentCancellationState.confirmed');
    case 'unsupported':
      return t('right.externalAgentCancellationState.unsupported');
    case 'failed':
      return t('right.externalAgentCancellationState.failed');
    case 'unknown':
      return t('right.externalAgentCancellationState.unknown');
  }
}

// ---- Changes section: git porcelain file list ----

function AgentMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}): JSX.Element {
  return (
    <span className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-secondary">
      <span className="text-fg-faint">{label}</span>{' '}
      <span className="font-mono text-fg-primary">{value}</span>
    </span>
  );
}

function AgentInlineList({
  agents,
}: {
  readonly agents: readonly AgentStatusViewModel[];
}): JSX.Element {
  return (
    <ul className="space-y-1.5">
      {agents.map((agent) => (
        <AgentStatusCard key={agent.id} agent={agent} compact />
      ))}
    </ul>
  );
}

function AgentStatusCard({
  agent,
  compact = false,
}: {
  readonly agent: AgentStatusViewModel;
  readonly compact?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <li
      className={`rounded-lg border px-2 py-1.5 ${agentCardClass(agent.state)}`}
      data-testid="task-dock-agent-card"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${agentDotClass(agent.state)}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-fg-primary" title={agent.title}>
              {agent.title}
            </span>
            <span className="flex-shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
              {agentStateLabel(agent.state, t)}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] text-fg-muted">
            {agent.role && <span>{agent.role}</span>}
            {agent.responsibility && <span className="truncate">/ {agent.responsibility}</span>}
          </div>
          {agent.latest && (
            <div
              className={`mt-1 text-[12px] leading-4 text-fg-secondary ${
                compact ? 'line-clamp-2' : ''
              }`}
              title={agent.latest}
            >
              {agent.latest}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-fg-faint">
            {agent.evidenceCount !== undefined && (
              <span>{t('right.notesCount', { count: agent.evidenceCount })}</span>
            )}
            {agent.traceCount !== undefined && (
              <span>{t('right.traceEventsCount', { count: agent.traceCount })}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function agentCardClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'border-run/40 bg-run/10';
    case 'waiting':
      return 'border-warn/40 bg-warn/10';
    case 'completed':
      return 'border-ok/35 bg-ok/10';
    case 'interrupted':
      return 'border-warn/40 bg-warn/10';
    case 'error':
      return 'border-danger/40 bg-danger/10';
    case 'idle':
      return 'border-border-default bg-surface-2';
  }
}

function agentDotClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'bg-run animate-pulse';
    case 'waiting':
      return 'bg-warn';
    case 'completed':
      return 'bg-ok';
    case 'interrupted':
      return 'bg-warn';
    case 'error':
      return 'bg-danger';
    case 'idle':
      return 'bg-fg-faint';
  }
}

function agentStateLabel(state: AgentStatusViewModel['state'], t: Translate): string {
  switch (state) {
    case 'active':
      return t('right.running');
    case 'waiting':
      return t('right.waiting');
    case 'completed':
      return t('right.done');
    case 'interrupted':
      return t('right.interrupted');
    case 'error':
      return t('right.issue');
    case 'idle':
      return t('right.idle');
  }
}

interface GitChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U';
  staged: boolean;
}

interface GitChangesSnapshot {
  isGitRepo: boolean;
  branch: string | null;
  files: GitChange[];
  truncated: boolean;
}

const CHANGES_REFRESH_DEBOUNCE_MS = 800;

function ChangesSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  // Watch write/edit/bash tool_result events and debounce a git changes refresh.
  const lastToolResultMarker = useAppStore((s) => {
    if (!currentSessionId) return 0;
    const evs = s.eventsBySession[currentSessionId] ?? [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.kind === 'session_start') return 0;
      if (ev.kind !== 'tool_result') continue;
      const name = (ev as { toolName?: string }).toolName;
      if (name === 'write' || name === 'edit' || name === 'bash' || name === 'multiedit') {
        return i;
      }
    }
    return 0;
  });

  const [snapshot, setSnapshot] = useState<GitChangesSnapshot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #11 fix: the old boolean in-flight guard dropped project B refreshes while
  // project A was still loading. Track the in-flight project path instead so same-path
  // refreshes dedupe, but project switches always issue a fresh request.

  const inFlightPathRef = useRef<string | null>(null);

  // F054: collapse large change lists by directory. Keep collapsed paths across refreshes.

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const toggleDir = useCallback((dirPath: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);
  const pickFile = useCallback((filePath: string): void => {
    useAppStore.getState().setLastDiffPath(filePath);
    requestShellPopout('diff');
  }, []);
  const tree = useMemo(() => buildChangeTree(snapshot?.files ?? []), [snapshot?.files]);

  const fetchChanges = useCallback((path: string): void => {
    if (!window.kodaxSpace) return;
    if (inFlightPathRef.current === path) return;
    inFlightPathRef.current = path;
    void window.kodaxSpace
      .invoke('project.gitChanges', { projectRoot: path })
      .then((r) => {
        if (!r.ok) return;
        // Drop stale responses after the user switches projects.
        if (useAppStore.getState().currentProjectPath !== path) return;
        setSnapshot({
          isGitRepo: r.data.isGitRepo,
          branch: r.data.branch,
          files: [...r.data.files],
          truncated: r.data.truncated,
        });
      })
      .finally(() => {
        if (inFlightPathRef.current === path) inFlightPathRef.current = null;
      });
  }, []);

  useEffect(() => {
    // Clear the old snapshot on project switch so another project's file list cannot flash
    // while the new request is loading.
    setSnapshot(null);
    if (!currentProjectPath) {
      return;
    }
    fetchChanges(currentProjectPath);
  }, [currentProjectPath, fetchChanges]);

  // Debounced tool-result refresh, plus focus/visibility and 30s fallback polling.
  useEffect(() => {
    if (!currentProjectPath || lastToolResultMarker === 0) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => fetchChanges(currentProjectPath),
      CHANGES_REFRESH_DEBOUNCE_MS,
    );
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [lastToolResultMarker, currentProjectPath, fetchChanges]);

  useEffect(() => {
    if (!currentProjectPath) return;
    const refresh = (): void => fetchChanges(currentProjectPath);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [currentProjectPath, fetchChanges]);

  if (!currentProjectPath) {
    return (
      <Section
        title={t('right.changes')}
        sectionId="changes"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="text-xs text-fg-muted">{t('right.openProjectForChanges')}</div>
      </Section>
    );
  }

  if (!snapshot) {
    return (
      <Section title={t('right.changes')} sectionId="changes" focusRequest={focusRequest}>
        <div className="text-xs text-fg-muted">{t('right.loadingChanges')}</div>
      </Section>
    );
  }

  if (!snapshot.isGitRepo) {
    return (
      <Section
        title={t('right.changes')}
        sectionId="changes"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="space-y-2 text-xs text-fg-muted">
          <div>{t('right.notGitRepo')}</div>
          <div className="leading-relaxed">{t('right.notGitRepoHelp')}</div>
          <button
            type="button"
            onClick={() => {
              requestShellPopout('files');
              window.dispatchEvent(new Event('kodax-space.open-files-workspace'));
              window.dispatchEvent(new Event('kodax-space.focus-artifact'));
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent/15"
          >
            <Folder className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('files.openProjectFiles')}
          </button>
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section
        title={`${t('right.changes')} (${snapshot.files.length}${snapshot.truncated ? '+' : ''})`}
        sectionId="changes"
        focusRequest={focusRequest}
      >
        {snapshot.branch && (
          <div className="text-[11px] text-fg-muted mb-1.5 font-mono">
            {t('right.onBranch', { branch: snapshot.branch })}
          </div>
        )}
        {snapshot.files.length === 0 ? (
          <div className="text-xs text-fg-muted">{t('right.workingTreeClean')}</div>
        ) : (
          <ul className="text-xs font-mono space-y-0.5">
            <ChangeTreeView
              node={tree}
              depth={0}
              collapsed={collapsed}
              onToggle={toggleDir}
              onPick={pickFile}
              onContextMenu={(path, x, y, trigger) => setFileMenu({ path, x, y, trigger })}
            />
            {snapshot.truncated && (
              <li className="text-fg-muted px-1">{t('right.moreTruncated', { count: 200 })}</li>
            )}
          </ul>
        )}
      </Section>
      {fileMenu && (
        <FileActionMenu
          path={fileMenu.path}
          x={fileMenu.x}
          y={fileMenu.y}
          trigger={fileMenu.trigger}
          primary="diff"
          onClose={() => setFileMenu(null)}
        />
      )}
    </>
  );
}

// ---- Changes tree: directory folding with single-chain compression ----

interface ChangeTreeNode {
  /** Display segment name; compressed nodes may look like "a/b/c". Root is empty. */
  name: string;
  /** Full directory path used as the collapse key. */
  path: string;
  dirs: ChangeTreeNode[];
  files: GitChange[];
  /** Total changed files under this subtree. */
  count: number;
}

/**
 * Build a directory tree from a flat changed-file list:
 *   1) split paths on '/' and attach files to their containing directory
 *   2) finalize count/sort/compress single-child directory chains, VS Code style
 */
function buildChangeTree(files: readonly GitChange[]): ChangeTreeNode {
  const root: ChangeTreeNode = { name: '', path: '', dirs: [], files: [], count: 0 };
  const dirMap = new Map<string, ChangeTreeNode>([['', root]]);

  function ensureDir(dirPath: string): ChangeTreeNode {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf('/');
    const parentPath = slash >= 0 ? dirPath.slice(0, slash) : '';
    const name = slash >= 0 ? dirPath.slice(slash + 1) : dirPath;
    const parent = ensureDir(parentPath);
    const node: ChangeTreeNode = { name, path: dirPath, dirs: [], files: [], count: 0 };
    parent.dirs.push(node);
    dirMap.set(dirPath, node);
    return node;
  }

  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const dirPath = slash >= 0 ? f.path.slice(0, slash) : '';
    ensureDir(dirPath).files.push(f);
  }

  function finalize(node: ChangeTreeNode): number {
    let c = node.files.length;
    for (const d of node.dirs) c += finalize(d);
    node.count = c;
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
    // Compress chains with no direct files and exactly one child directory.
    node.dirs = node.dirs.map((d) => {
      let cur = d;
      while (cur.files.length === 0 && cur.dirs.length === 1) {
        const child = cur.dirs[0];
        cur = {
          name: `${cur.name}/${child.name}`,
          path: child.path,
          dirs: child.dirs,
          files: child.files,
          count: child.count,
        };
      }
      return cur;
    });
    return c;
  }
  finalize(root);
  return root;
}

interface ChangeTreeViewProps {
  node: ChangeTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (dirPath: string) => void;
  onPick: (filePath: string) => void;
  onContextMenu: (filePath: string, x: number, y: number, trigger: HTMLElement) => void;
}

/** Recursive directory tree renderer: folders fold, file rows open diff. */
function ChangeTreeView({
  node,
  depth,
  collapsed,
  onToggle,
  onPick,
  onContextMenu,
}: ChangeTreeViewProps): JSX.Element {
  const pad = (d: number): React.CSSProperties => ({ paddingLeft: `${d * 11 + 4}px` });
  return (
    <>
      {node.dirs.map((d) => {
        const isCollapsed = collapsed.has(d.path);
        return (
          <li key={`d:${d.path}`}>
            <button
              type="button"
              onClick={() => onToggle(d.path)}
              style={pad(depth)}
              className="w-full text-left flex items-center gap-1 pr-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
              aria-expanded={!isCollapsed}
              title={d.path}
            >
              <ChevronRight
                className={`w-3 h-3 flex-shrink-0 text-fg-faint transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                strokeWidth={2}
              />
              <Folder className="w-3 h-3 flex-shrink-0 text-fg-muted" strokeWidth={1.75} />
              <span className="truncate flex-1">{d.name}</span>
              <span className="text-fg-faint tabular-nums">{d.count}</span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-0.5">
                <ChangeTreeView
                  node={d}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onPick={onPick}
                  onContextMenu={onContextMenu}
                />
              </ul>
            )}
          </li>
        );
      })}
      {node.files.map((f) => (
        <li key={`f:${f.path}_${f.status}_${f.staged ? 'S' : 'U'}`}>
          <button
            type="button"
            onClick={() => onPick(f.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(f.path, e.clientX, e.clientY, e.currentTarget);
            }}
            style={pad(depth)}
            className="w-full text-left flex items-center gap-1.5 pr-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
            title={f.path}
            data-testid="task-dock-change-file"
          >
            <StatusBadge status={f.status} staged={f.staged} />
            <FileNameText
              name={f.path.slice(f.path.lastIndexOf('/') + 1)}
              className="flex-1"
              title={f.path}
            />
          </button>
        </li>
      ))}
    </>
  );
}

function StatusBadge({
  status,
  staged,
}: {
  status: GitChange['status'];
  staged: boolean;
}): JSX.Element {
  const { t } = useI18n();
  // Color: staged = ok, worktree-only = warning, untracked = muted; letter is git status.
  const color = status === 'U' ? 'text-fg-muted' : staged ? 'text-ok' : 'text-warn';
  return (
    <span
      className={`flex-shrink-0 w-4 text-[11px] font-bold text-center ${color}`}
      title={`${changeStatusLabel(status, t)}${staged ? ` (${t('right.status.staged')})` : ''}`}
      aria-hidden
    >
      {status}
    </span>
  );
}

function changeStatusLabel(status: GitChange['status'], t: Translate): string {
  switch (status) {
    case 'U':
      return t('right.status.untracked');
    case 'M':
      return t('right.status.modified');
    case 'A':
      return t('right.status.added');
    case 'D':
      return t('right.status.deleted');
    case 'R':
      return t('right.status.renamed');
  }
}

function ArtifactsSummarySection({
  focusRequest,
  artifactCount,
  hasArtifactSurface,
  artifactError,
  onOpenArtifact,
}: {
  readonly focusRequest: TaskDockFocusState;
  readonly artifactCount: number;
  readonly hasArtifactSurface: boolean;
  readonly artifactError: unknown;
  readonly onOpenArtifact: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Section
      title={t('right.artifacts')}
      sectionId="artifacts"
      focusRequest={focusRequest}
      defaultOpen={false}
    >
      {hasArtifactSurface ? (
        <div className="space-y-2 text-xs text-fg-secondary">
          <div>
            {artifactError
              ? t('right.artifactLoadingNeedsAttention')
              : t('right.artifactsAvailable', { count: artifactCount })}
          </div>
          <button
            type="button"
            onClick={onOpenArtifact}
            className="rounded-md border border-border-default px-2 py-1 text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
          >
            {t('right.openArtifactWorkspace')}
          </button>
        </div>
      ) : (
        <div className="text-xs text-fg-muted">{t('right.generatedArtifactsEmpty')}</div>
      )}
    </Section>
  );
}

// ---- Working folder section ----

function SourcesSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element {
  const { t } = useI18n();
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section
      title={t('right.sources')}
      sectionId="sources"
      focusRequest={focusRequest}
      defaultOpen={false}
    >
      {projectPath ? (
        <div className="text-xs text-fg-secondary space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">
            {t('right.workingFolder')}
          </div>
          <div className="flex items-center gap-1.5">
            <Folder
              className="w-3.5 h-3.5 text-accent-ink flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="font-medium text-fg-primary truncate" title={projectPath}>
              {projectName}
            </span>
          </div>
          {/* Clickable working folder path: reveal in the file manager. */}
          <button
            type="button"
            onClick={() => void revealPath(projectPath)}
            title={t('right.revealInFileManager')}
            className="group/wf w-full text-left flex items-start gap-1 text-fg-muted text-[11px] font-mono break-all hover:text-fg-secondary"
          >
            <span className="break-all">{projectPath}</span>
            <FolderOpen
              className="w-3 h-3 mt-0.5 flex-shrink-0 text-fg-faint opacity-0 group-hover/wf:opacity-100"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>
      ) : (
        <div className="text-xs text-fg-muted">{t('right.noProjectOpen')}</div>
      )}
    </Section>
  );
}

// ---- Context section ----

function ContextSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );

  const refs = useMemo(() => collectContextRefs(events), [events]);
  const contextFilesJson = JSON.stringify(refs.files);
  const [visibleFiles, setVisibleFiles] = useState<readonly string[]>([]);
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bridge = window.kodaxSpace;
    const contextFiles = JSON.parse(contextFilesJson) as string[];
    if (!currentProjectPath || contextFiles.length === 0) {
      setVisibleFiles([]);
      return () => {
        cancelled = true;
      };
    }
    if (!bridge) {
      setVisibleFiles(contextFiles);
      return () => {
        cancelled = true;
      };
    }

    setVisibleFiles([]);
    void Promise.all(
      contextFiles.map(async (filePath) => {
        const rawPath = filePath.trim();
        if (
          rawPath.length === 0 ||
          rawPath.length > 4096 ||
          isAbsolutePathOutsideProject(rawPath, currentProjectPath)
        ) {
          return null;
        }
        const relPath = toProjectRelative(rawPath, currentProjectPath);
        if (relPath.length === 0) return null;
        try {
          const result = await bridge.invoke('files.stat', {
            projectRoot: currentProjectPath,
            path: relPath,
          });
          if (!result.ok || !result.data.exists) return null;
          return filePath;
        } catch {
          return null;
        }
      }),
    ).then((files) => {
      if (!cancelled) {
        setVisibleFiles(files.filter((filePath): filePath is string => filePath !== null));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentProjectPath, contextFilesJson]);

  if (refs.tools.length === 0 && visibleFiles.length === 0) {
    return (
      <Section
        title={t('right.context')}
        sectionId="context"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="text-xs text-fg-muted leading-relaxed">{t('right.contextEmpty')}</div>
      </Section>
    );
  }

  return (
    <>
      <Section
        title={t('right.context')}
        sectionId="context"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        {refs.tools.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1">
              {t('right.toolsUsed')}
            </div>
            <div className="flex flex-wrap gap-1">
              {refs.tools.map((t) => (
                <span
                  key={t.name}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-secondary"
                  title={`${t.count}x ${t.name}`}
                >
                  {t.name}
                  {t.count > 1 && <span className="text-fg-muted ml-0.5">x{t.count}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
        {visibleFiles.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <span>{t('right.filesReferenced')}</span>
              <span className="font-mono normal-case tracking-normal">{visibleFiles.length}</span>
            </div>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border-default/70 bg-surface-3/35 p-1 text-xs font-mono">
              {visibleFiles.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => void openFileInViewer(f)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setFileMenu({
                        path: f,
                        x: e.clientX,
                        y: e.clientY,
                        trigger: e.currentTarget,
                      });
                    }}
                    className="group/ctxfile w-full text-left flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
                    title={t('fileActions.openInFileViewer')}
                  >
                    <FileNameText name={f} className="flex-1" />
                    <Eye
                      className="w-3 h-3 flex-shrink-0 text-fg-faint opacity-0 group-hover/ctxfile:opacity-100"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      {fileMenu && (
        <FileActionMenu
          path={fileMenu.path}
          x={fileMenu.x}
          y={fileMenu.y}
          trigger={fileMenu.trigger}
          primary="artifact"
          onClose={() => setFileMenu(null)}
        />
      )}
    </>
  );
}

interface ContextRefs {
  readonly tools: ReadonlyArray<{ name: string; count: number }>;
  readonly files: readonly string[];
}

function collectContextRefs(events: readonly SessionEvent[]): ContextRefs {
  const toolCounts = new Map<string, number>();
  const files = new Set<string>();
  for (const ev of events) {
    if (ev.kind === 'tool_start') {
      const name = (ev as { toolName?: string }).toolName;
      if (typeof name === 'string') {
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
      const input = (ev as { input?: unknown }).input;
      if (input && typeof input === 'object') {
        const path =
          (input as { path?: unknown; file_path?: unknown }).path ??
          (input as { file_path?: unknown }).file_path;
        if (typeof path === 'string' && path.length > 0 && path.length < 512) {
          files.add(path);
        }
      }
    }
  }
  return {
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    files: [...files],
  };
}

// ---- SVG-free status dots ----

function CircleDone({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full bg-ok text-white flex items-center justify-center`}
      aria-hidden
    >
      <Check className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={3.5} />
    </span>
  );
}
function CircleActive({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border-2 border-run bg-run/30 animate-pulse`}
      aria-hidden
    />
  );
}
function CircleEmpty({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return <span className={`${size} rounded-full border border-border-default`} aria-hidden />;
}

function CircleFailed({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full bg-danger text-white flex items-center justify-center`}
      aria-hidden
    >
      <X className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={3.25} />
    </span>
  );
}

function CircleMuted({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border border-border-strong text-fg-faint flex items-center justify-center`}
      aria-hidden
    >
      <Minus className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={2.5} />
    </span>
  );
}

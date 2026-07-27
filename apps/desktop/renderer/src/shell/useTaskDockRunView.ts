import { useMemo } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { useAppStore } from '../store/appStore.js';
import {
  buildTaskDockRunView,
  type BuildTaskDockRunInput,
  type TaskDockRunViewModel,
} from './taskDockProjection.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

interface CachedRunView {
  readonly input: BuildTaskDockRunInput;
  readonly view: TaskDockRunViewModel;
}

let cachedRunView: CachedRunView | null = null;

export interface UseTaskDockRunViewResult {
  readonly view: TaskDockRunViewModel;
  readonly hasProject: boolean;
  readonly hasSession: boolean;
}

export function useTaskDockRunView(): UseTaskDockRunViewResult {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const pendingSend = useAppStore((s) =>
    currentSessionId ? (s.pendingSendBySession[currentSessionId] ?? false) : false,
  );
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );
  const managedStatus = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const actorSnapshot = useAppStore((s) =>
    currentSessionId ? s.agentActorSnapshotBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const hasPermissionRequest = useAppStore((s) =>
    currentSessionId
      ? s.permissionQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const hasAskUserRequest = useAppStore((s) =>
    currentSessionId
      ? s.askUserQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const workflowRuns = useSessionWorkflowRuns();
  const hasProject = currentProjectPath !== null;
  const hasSession = currentSessionId !== null;

  const view = useMemo(
    () =>
      getCachedTaskDockRunView({
        hasProject,
        hasSession,
        pendingSend,
        todos,
        managedStatus,
        actorSnapshot,
        workflowRuns,
        events,
        budget,
        hasPermissionRequest,
        hasAskUserRequest,
        t,
      }),
    [
      hasProject,
      hasSession,
      pendingSend,
      todos,
      managedStatus,
      actorSnapshot,
      workflowRuns,
      events,
      budget,
      hasPermissionRequest,
      hasAskUserRequest,
      t,
    ],
  );

  return { view, hasProject, hasSession };
}

export function getCachedTaskDockRunView(input: BuildTaskDockRunInput): TaskDockRunViewModel {
  if (cachedRunView && sameRunViewInput(cachedRunView.input, input)) {
    return cachedRunView.view;
  }
  const view = buildTaskDockRunView(input);
  cachedRunView = { input, view };
  return view;
}

function sameRunViewInput(a: BuildTaskDockRunInput, b: BuildTaskDockRunInput): boolean {
  return (
    a.hasProject === b.hasProject &&
    a.hasSession === b.hasSession &&
    a.pendingSend === b.pendingSend &&
    a.todos === b.todos &&
    a.managedStatus === b.managedStatus &&
    a.actorSnapshot === b.actorSnapshot &&
    sameArrayItems(a.workflowRuns, b.workflowRuns) &&
    a.events === b.events &&
    a.budget === b.budget &&
    a.hasPermissionRequest === b.hasPermissionRequest &&
    a.hasAskUserRequest === b.hasAskUserRequest &&
    a.t === b.t
  );
}

function sameArrayItems<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

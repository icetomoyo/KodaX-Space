// App — renderer bootstrap shell.
//
// 顶层负责：
//   - 一次性订阅 push channel `session.event`，按 sessionId 路由进 store
//   - 启动期拉取 version / providers / defaults / project 列表
//   - 渲染新 Shell，以及仍需 hoist 到 App 层的 provider settings / quick ask overlay
//
// 不在这里：
//   - 业务状态——全部 Zustand store
//   - layout 结构——由 shell/* 接管

import { useEffect, useRef, useState } from 'react';
import type {
  SpaceRuntimeDefaultsT,
  SpaceRuntimeProfileProjectionT,
  SpaceVersionOutput,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from './store/appStore.js';
import { pushToast } from './store/toastStore.js';
import { useI18n } from './i18n/I18nProvider.js';
import { SettingsModal } from './features/settings/SettingsModal.js';
import { QuickAskPopover } from './features/quick-ask/QuickAskPopover.js';
import { useSessionCompleteNotification } from './features/notifications/useSessionCompleteNotification.js';
import { useAppBadgeCount } from './features/notifications/useAppBadgeCount.js';
import { Shell } from './shell/Shell.js';
import { CompleteExitOverlay } from './shell/CompleteExitOverlay.js';
import { formatWorkflowEventNotices } from './features/workflow/workflowNotices.js';
import { requestTaskDockFocus } from './shell/taskDockControl.js';
import {
  runtimeConnectionHasFreshLiveAuthority,
  runtimeBootstrapRetryDelayMs,
  runtimeProfileConflictsWithLive,
  runtimeSessionNeedsPeriodicReconciliation,
  runtimeSessionRequiresImmediateObservation,
  runtimeSessionNeedsObservation,
  runtimeTerminalEvidenceCandidates,
  sessionLiveProjectionHasActivity,
  shouldBootstrapSelectedSessionLive,
  shouldReconcileRuntimeConnection,
  shouldRerunRejectedHydrationSnapshot,
  shouldRequestSessionLiveSnapshot,
  terminalEventEvidence,
  type RuntimeTerminalEvidence,
} from './store/runtimeProjectionState.js';
import { createSessionEventBatcher } from './store/sessionEventBatcher.js';
import { invokeWithTimeout } from './lib/ipcInvokeWithTimeout.js';
import { SPACE_VERSION_REFRESH_EVENT } from './lib/versionEvents.js';
import {
  historyPhaseAllowsRuntimeObservation,
  invalidateSessionHistoryPaging,
  reconcileTerminalSessionHistory,
  refreshDeferredSessionHistory,
  revalidateNewestSessionHistory,
  sessionEventInvalidatesHistoryCache,
  sessionHistoryPagingSnapshot,
  useSessionHistoryPaging,
  wakeWaitingSessionHistory,
} from './shell/sessionHistoryPaging.js';

// Shell owns the visible layout; App keeps process-wide bootstrapping and global listeners.
// Workflow notice dedup lives in appendEvent keyed workflow_notice events, not a module
// Set here. The notices must share the session.event stream with assistant text so a
// workflow result lands before the main-agent report that follows it.

interface LiveSnapshotRequestOptions {
  readonly allowEqualHydration?: boolean;
  /** Causal invalidations rerun; focus/timer hints only join the request already in flight. */
  readonly rerunIfInFlight?: boolean;
}

const MAX_BACKGROUND_LIVE_RECONCILIATIONS = 4;

export default function App(): JSX.Element {
  const [version, setVersion] = useState<SpaceVersionOutput | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // F018 Quick Ask popover —— Cmd/Ctrl+K toggles
  const [showQuickAsk, setShowQuickAsk] = useState(false);
  const { t } = useI18n();
  const appendEvent = useAppStore((s) => s.appendEvent);
  const enqueuePermission = useAppStore((s) => s.enqueuePermission);
  const dequeuePermission = useAppStore((s) => s.dequeuePermission);
  const enqueueAskUser = useAppStore((s) => s.enqueueAskUser);
  const dequeueAskUser = useAppStore((s) => s.dequeueAskUser);
  const setProviders = useAppStore((s) => s.setProviders);
  const setKodaxDefaults = useAppStore((s) => s.setKodaxDefaults);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);
  const setCoderRuntimeConnection = useAppStore((s) => s.setCoderRuntimeConnection);
  const replaceAgentActorSnapshot = useAppStore((s) => s.replaceAgentActorSnapshot);
  const replaceRuntimeProfileProjection = useAppStore((s) => s.replaceRuntimeProfileProjection);
  const replaceSessionLiveProjection = useAppStore((s) => s.replaceSessionLiveProjection);
  const applySessionLiveProjectionChange = useAppStore((s) => s.applySessionLiveProjectionChange);
  const invalidateSessionLiveProjection = useAppStore((s) => s.invalidateSessionLiveProjection);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingPermissionMode = useAppStore((s) => s.setPendingPermissionMode);
  const setPendingAgentMode = useAppStore((s) => s.setPendingAgentMode);
  const setQueueState = useAppStore((s) => s.setQueueState);
  const upsertWorkflowRun = useAppStore((s) => s.upsertWorkflowRun);
  const seedWorkflowRuns = useAppStore((s) => s.seedWorkflowRuns);
  const appendWorkflowActivity = useAppStore((s) => s.appendWorkflowActivity);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentSessionHistory = useSessionHistoryPaging(currentSessionId);
  const currentSessionHistoryAllowsObservation = historyPhaseAllowsRuntimeObservation(
    currentSessionHistory.phase,
  );
  const currentSessionNeedsRuntimeObservation = useAppStore((state) =>
    currentSessionId
      ? runtimeSessionNeedsObservation(
          {
            profile: state.runtimeProfile,
            liveBySession: state.liveProjectionBySession,
            snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
          },
          currentSessionId,
        )
      : false,
  );
  const coderRuntimeReady = useAppStore((s) =>
    runtimeConnectionHasFreshLiveAuthority(s.runtimeConnection),
  );
  const hasCurrentLiveProjection = useAppStore((s) =>
    currentSessionId ? Boolean(s.liveProjectionBySession[currentSessionId]) : false,
  );
  const currentSessionHasImmediateRuntimeActivity = useAppStore((state) => {
    if (!currentSessionId) return false;
    return runtimeSessionRequiresImmediateObservation(
      {
        connection: state.runtimeConnection,
        profile: state.runtimeProfile,
        liveBySession: state.liveProjectionBySession,
        snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
      },
      currentSessionId,
    );
  });
  const hasCurrentActorSnapshot = useAppStore((s) =>
    currentSessionId ? Boolean(s.agentActorSnapshotBySession[currentSessionId]) : false,
  );
  const setSessionFlag = useAppStore((s) => s.setSessionFlag);
  const unsubsRef = useRef<Array<() => void>>([]);
  const requestCoderLiveSnapshotRef = useRef<
    (sessionId: string, options?: LiveSnapshotRequestOptions) => void
  >(() => {});

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    let disposed = false;
    const liveSnapshotRequests = new Set<string>();
    const liveSnapshotActiveIntents = new Map<string, { allowEqualHydration: boolean }>();
    const liveSnapshotReruns = new Map<string, LiveSnapshotRequestOptions>();
    const liveSnapshotRetryAttempts = new Map<string, number>();
    const liveSnapshotRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let runtimeProfileRetryAttempt = 0;
    let runtimeProfileRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let runtimeProfileBootstrapped = false;
    let runtimeProfileRequestInFlight = false;
    let runtimeProfileRerun = false;
    let backgroundReconciliationCursor = 0;
    let requestLiveSnapshot: (
      sessionId: string,
      options?: LiveSnapshotRequestOptions,
    ) => void = () => {};
    const reconcileTerminalHistory = (evidence: RuntimeTerminalEvidence): void => {
      void reconcileTerminalSessionHistory(evidence).catch((error: unknown) => {
        console.error('[session.history] terminal reconciliation failed', {
          sessionId: evidence.sessionId,
          runtimeId: evidence.runtimeId,
          runId: evidence.runId,
          error,
        });
      });
    };
    const reconcileAuthoritativeTerminalHistory = (sessionId: string): boolean => {
      const state = useAppStore.getState();
      const evidence = runtimeTerminalEvidenceCandidates(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
        },
        sessionId,
      );
      if (evidence.length === 0) return false;
      for (const terminal of evidence) reconcileTerminalHistory(terminal);
      return true;
    };
    const reconcileTerminalEventHistory = (event: Parameters<typeof appendEvent>[0]): boolean => {
      if (event.kind !== 'session_complete' && event.kind !== 'session_error') return false;
      const state = useAppStore.getState();
      const evidence = terminalEventEvidence({
        kind: event.kind,
        sessionId: event.sessionId,
        runtimeEvent: event.runtimeEvent,
        connection: state.runtimeConnection,
        liveBySession: state.liveProjectionBySession,
      });
      if (evidence === undefined) {
        return reconcileAuthoritativeTerminalHistory(event.sessionId);
      }
      reconcileTerminalHistory(evidence);
      return true;
    };
    const sessionEventBatcher = createSessionEventBatcher(
      (event) => {
        appendEvent(event);
        if (event.kind === 'session_complete' || event.kind === 'session_error') {
          if (!reconcileTerminalEventHistory(event)) {
            invalidateSessionHistoryPaging(event.sessionId);
          }
          void refreshDeferredSessionHistory(event.sessionId).catch((error: unknown) => {
            console.error('[session.history] deferred terminal refresh failed', error);
          });
        }
      },
      {
        snapshotCursor: (sessionId) =>
          useAppStore.getState().runtimeSnapshotCursorBySession[sessionId],
      },
    );

    const requireLiveSnapshot = (sessionId: string): void => {
      useAppStore.setState((state) =>
        state.runtimeSnapshotRequiredBySession[sessionId] === true
          ? state
          : {
              runtimeSnapshotRequiredBySession: {
                ...state.runtimeSnapshotRequiredBySession,
                [sessionId]: true as const,
              },
            },
      );
    };
    const clearLiveSnapshotRetry = (sessionId: string): void => {
      const timer = liveSnapshotRetryTimers.get(sessionId);
      if (timer !== undefined) clearTimeout(timer);
      liveSnapshotRetryTimers.delete(sessionId);
      liveSnapshotRetryAttempts.delete(sessionId);
    };
    const scheduleLiveSnapshotRetry = (
      sessionId: string,
      error: unknown,
      options: LiveSnapshotRequestOptions = {},
    ): void => {
      requireLiveSnapshot(sessionId);
      const attempt = (liveSnapshotRetryAttempts.get(sessionId) ?? 0) + 1;
      liveSnapshotRetryAttempts.set(sessionId, attempt);
      console.error('[session.liveSnapshot] reconciliation failed', {
        sessionId,
        attempt,
        error,
      });
      if (attempt > 3 || disposed || liveSnapshotRetryTimers.has(sessionId)) return;
      const delayMs = runtimeBootstrapRetryDelayMs(attempt);
      if (delayMs === undefined) return;
      const timer = setTimeout(() => {
        liveSnapshotRetryTimers.delete(sessionId);
        if (!disposed) requestLiveSnapshot(sessionId, options);
      }, delayMs);
      liveSnapshotRetryTimers.set(sessionId, timer);
    };

    // Listener-first Runtime bootstrap. A cursor gap requests one atomic observation snapshot
    // instead of attempting to replay partial daemon events.
    requestLiveSnapshot = (sessionId: string, options: LiveSnapshotRequestOptions = {}): void => {
      const retryTimer = liveSnapshotRetryTimers.get(sessionId);
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        liveSnapshotRetryTimers.delete(sessionId);
      }
      if (liveSnapshotRequests.has(sessionId)) {
        if (options.rerunIfInFlight === false) {
          const activeIntent = liveSnapshotActiveIntents.get(sessionId);
          if (activeIntent && options.allowEqualHydration === true) {
            // Equal hydration only changes renderer acceptance; upgrade the read already in flight
            // instead of losing activation recovery or paying for a second snapshot IPC.
            activeIntent.allowEqualHydration = true;
          }
          return;
        }
        // Do not lose a causal terminal/invalidation reconciliation that races an older read.
        const pending = liveSnapshotReruns.get(sessionId);
        liveSnapshotReruns.set(sessionId, {
          allowEqualHydration:
            pending?.allowEqualHydration === true || options.allowEqualHydration === true,
        });
        return;
      }
      liveSnapshotRequests.add(sessionId);
      const activeIntent = {
        allowEqualHydration: options.allowEqualHydration === true,
      };
      liveSnapshotActiveIntents.set(sessionId, activeIntent);
      // Hold this Session's cursor-bearing Runtime events until the authoritative snapshot cursor
      // arrives. Draining the held events in raw order before reconciliation preserves lifecycle
      // and tool positions; the accepted per-draft watermark rejects only later covered replays.
      sessionEventBatcher.pause(sessionId);
      let scheduledRetry = false;
      void invokeWithTimeout(bridge, 'session.liveSnapshot', { sessionId })
        .then((result) => {
          if (!result.ok) throw new Error(result.error?.message ?? 'Session live snapshot failed.');
          if (disposed) return;
          // Install the incoming causal barrier while draining. This lets a large fragment backlog
          // collapse without joining a covered delta to a post-snapshot delta.
          const previousBarrier = useAppStore.getState().runtimeSnapshotCursorBySession[sessionId];
          const snapshotRun = result.data.activeRun ?? result.data.lastTerminalRun;
          const sameBarrierRun =
            snapshotRun !== undefined &&
            previousBarrier?.runtimeId === result.data.cursor.runtimeId &&
            previousBarrier.runId === snapshotRun.runId;
          sessionEventBatcher.drain(
            sessionId,
            snapshotRun === undefined
              ? result.data.cursor
              : {
                  ...result.data.cursor,
                  runId: snapshotRun.runId,
                  ...(result.data.assistantDraft !== undefined
                    ? { assistantDraftSeq: result.data.cursor.seq }
                    : sameBarrierRun && previousBarrier.assistantDraftSeq !== undefined
                      ? { assistantDraftSeq: previousBarrier.assistantDraftSeq }
                      : {}),
                  ...(result.data.thinkingDraft !== undefined
                    ? { thinkingDraftSeq: result.data.cursor.seq }
                    : sameBarrierRun && previousBarrier.thinkingDraftSeq !== undefined
                      ? { thinkingDraftSeq: previousBarrier.thinkingDraftSeq }
                      : {}),
                },
          );
          const accepted = replaceSessionLiveProjection(
            result.data,
            activeIntent.allowEqualHydration ? { allowEqualHydration: true } : undefined,
          );
          if (accepted) reconcileAuthoritativeTerminalHistory(sessionId);
          const currentState = useAppStore.getState();
          const currentProjection = currentState.liveProjectionBySession[sessionId];
          if (
            !accepted &&
            shouldRerunRejectedHydrationSnapshot({
              allowEqualHydration: activeIntent.allowEqualHydration,
              connection: currentState.runtimeConnection,
              current: currentProjection,
              incoming: result.data,
            })
          ) {
            scheduledRetry = true;
            scheduleLiveSnapshotRetry(
              sessionId,
              new Error('A newer live projection overtook the hydration snapshot.'),
              { allowEqualHydration: true },
            );
          }
          if (!scheduledRetry) clearLiveSnapshotRetry(sessionId);
        })
        .catch((error: unknown) => {
          if (!disposed) {
            scheduleLiveSnapshotRetry(sessionId, error, {
              ...options,
              ...(activeIntent.allowEqualHydration ? { allowEqualHydration: true } : {}),
            });
          }
        })
        .finally(() => {
          if (disposed) return;
          liveSnapshotRequests.delete(sessionId);
          liveSnapshotActiveIntents.delete(sessionId);
          const rerun = liveSnapshotReruns.get(sessionId);
          if (rerun !== undefined) {
            liveSnapshotReruns.delete(sessionId);
            sessionEventBatcher.resume(sessionId);
            requestLiveSnapshot(sessionId, rerun);
          } else {
            sessionEventBatcher.resume(sessionId);
          }
        });
    };
    requestCoderLiveSnapshotRef.current = requestLiveSnapshot;
    const requestCurrentCoderLiveSnapshot = (
      options: Pick<LiveSnapshotRequestOptions, 'rerunIfInFlight'> = {},
    ): void => {
      const state = useAppStore.getState();
      const sessionId = state.currentSessionId;
      if (!sessionId) return;
      const selected = state.sessions.find((session) => session.sessionId === sessionId);
      if (selected?.surface === 'partner') return;
      if (
        !runtimeSessionNeedsObservation(
          {
            profile: state.runtimeProfile,
            liveBySession: state.liveProjectionBySession,
            snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
          },
          sessionId,
        )
      ) {
        return;
      }
      const immediate = runtimeSessionRequiresImmediateObservation(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        sessionId,
      );
      if (
        !immediate &&
        !historyPhaseAllowsRuntimeObservation(sessionHistoryPagingSnapshot(sessionId).phase)
      ) {
        return;
      }
      requestLiveSnapshot(sessionId, { allowEqualHydration: true, ...options });
    };
    const recoverCurrentSessionAtRuntimeEdge = (
      options: Pick<LiveSnapshotRequestOptions, 'rerunIfInFlight'> = {},
    ): void => {
      const state = useAppStore.getState();
      const sessionId = state.currentSessionId;
      if (!sessionId) return;
      const selected = state.sessions.find((session) => session.sessionId === sessionId);
      if (selected?.surface === 'partner') return;
      const immediate = runtimeSessionRequiresImmediateObservation(
        {
          connection: state.runtimeConnection,
          profile: state.runtimeProfile,
          liveBySession: state.liveProjectionBySession,
          snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
        },
        sessionId,
      );
      if (!immediate) {
        void wakeWaitingSessionHistory(sessionId).catch((error: unknown) => {
          console.error('[session.history] Runtime-ready wake failed', { sessionId, error });
        });
      }
      requestCurrentCoderLiveSnapshot(options);
    };
    const requestObservedActiveLiveSnapshots = (
      options: {
        readonly visibleOnly?: boolean;
        readonly excludeSessionId?: string;
      } = {},
    ): ReadonlySet<string> => {
      const state = useAppStore.getState();
      const requested = new Set<string>();
      if (options.visibleOnly === true && document.hidden) return requested;
      if (!runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) return requested;
      const candidates = Object.entries(state.liveProjectionBySession).filter(
        ([sessionId, projection]) =>
          projection !== undefined &&
          sessionLiveProjectionHasActivity(projection) &&
          projection.cursor.runtimeId === state.runtimeConnection.runtimeId &&
          sessionId !== options.excludeSessionId &&
          !liveSnapshotRequests.has(sessionId) &&
          state.sessions.find((session) => session.sessionId === sessionId)?.surface !== 'partner',
      );
      const start =
        candidates.length === 0 ? 0 : backgroundReconciliationCursor % candidates.length;
      let visited = 0;
      while (visited < candidates.length && requested.size < MAX_BACKGROUND_LIVE_RECONCILIATIONS) {
        const candidate = candidates[(start + visited) % candidates.length];
        visited += 1;
        if (candidate === undefined) continue;
        requested.add(candidate[0]);
        requestLiveSnapshot(candidate[0]);
      }
      if (candidates.length > 0) {
        backgroundReconciliationCursor = (start + visited) % candidates.length;
      }
      return requested;
    };
    const requestPeriodicCurrentCoderLiveSnapshot = (): string | undefined => {
      const state = useAppStore.getState();
      const sessionId = state.currentSessionId;
      if (!sessionId || liveSnapshotRequests.has(sessionId)) return undefined;
      const selected = state.sessions.find((session) => session.sessionId === sessionId);
      if (selected?.surface === 'partner') return undefined;
      if (
        !runtimeSessionNeedsPeriodicReconciliation(
          {
            connection: state.runtimeConnection,
            profile: state.runtimeProfile,
            liveBySession: state.liveProjectionBySession,
            snapshotRequiredBySession: state.runtimeSnapshotRequiredBySession,
          },
          sessionId,
        )
      ) {
        return undefined;
      }
      requestLiveSnapshot(sessionId, {
        allowEqualHydration: true,
        rerunIfInFlight: false,
      });
      return sessionId;
    };
    const requestObservedProfileConflicts = (): void => {
      const state = useAppStore.getState();
      if (!runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection)) return;
      const profile = state.runtimeProfile;
      if (profile === null || profile.connection.runtimeId !== state.runtimeConnection.runtimeId)
        return;
      for (const [sessionId, projection] of Object.entries(state.liveProjectionBySession)) {
        if (!sessionLiveProjectionHasActivity(projection)) continue;
        if (runtimeProfileConflictsWithLive(profile, sessionId, projection)) {
          requestLiveSnapshot(sessionId);
        }
      }
    };
    const clearRuntimeProfileRetry = (): void => {
      if (runtimeProfileRetryTimer !== undefined) clearTimeout(runtimeProfileRetryTimer);
      runtimeProfileRetryTimer = undefined;
      runtimeProfileRetryAttempt = 0;
    };
    const acceptRuntimeProfile = (profile: SpaceRuntimeProfileProjectionT): boolean => {
      const wasBootstrapped = runtimeProfileBootstrapped;
      replaceRuntimeProfileProjection(profile);
      const state = useAppStore.getState();
      runtimeProfileBootstrapped =
        state.runtimeProfile !== null &&
        runtimeConnectionHasFreshLiveAuthority(state.runtimeConnection) &&
        state.runtimeProfile.connection.runtimeId === state.runtimeConnection.runtimeId;
      if (runtimeProfileBootstrapped) clearRuntimeProfileRetry();
      if (!wasBootstrapped && runtimeProfileBootstrapped) {
        recoverCurrentSessionAtRuntimeEdge({ rerunIfInFlight: false });
      }
      requestObservedProfileConflicts();
      if (runtimeProfileBootstrapped) {
        for (const session of profile.sessions) {
          if (session.lastTerminalRun !== undefined) {
            reconcileAuthoritativeTerminalHistory(session.sessionId);
          }
        }
      }
      return runtimeProfileBootstrapped;
    };
    const requestRuntimeProfileSnapshot = (): void => {
      if (runtimeProfileRequestInFlight) {
        runtimeProfileRerun = true;
        return;
      }
      if (runtimeProfileRetryTimer !== undefined) {
        clearTimeout(runtimeProfileRetryTimer);
        runtimeProfileRetryTimer = undefined;
      }
      runtimeProfileRequestInFlight = true;
      runtimeProfileRetryAttempt += 1;
      const attempt = runtimeProfileRetryAttempt;
      let accepted = false;
      void invokeWithTimeout(bridge, 'runtime.profileSnapshot', undefined)
        .then((result) => {
          if (disposed) return;
          if (!result.ok)
            throw new Error(result.error?.message ?? 'Runtime profile snapshot failed.');
          if (!acceptRuntimeProfile(result.data)) {
            throw new Error('Runtime profile snapshot was not accepted.');
          }
          accepted = true;
        })
        .catch((error: unknown) => {
          if (disposed) return;
          runtimeProfileRerun = false;
          console.error('[runtime.profileSnapshot] bootstrap failed', { attempt, error });
          const delayMs = runtimeBootstrapRetryDelayMs(attempt);
          if (delayMs === undefined) return;
          runtimeProfileRetryTimer = setTimeout(() => {
            runtimeProfileRetryTimer = undefined;
            if (!disposed) requestRuntimeProfileSnapshot();
          }, delayMs);
        })
        .finally(() => {
          runtimeProfileRequestInFlight = false;
          if (accepted && runtimeProfileRerun && !disposed) {
            runtimeProfileRerun = false;
            requestRuntimeProfileSnapshot();
          }
        });
    };
    const flushSessionEventsIfActive = (): void => {
      if (document.hidden || !document.hasFocus()) return;
      sessionEventBatcher.flush();
      requestRuntimeProfileSnapshot();
      recoverCurrentSessionAtRuntimeEdge({ rerunIfInFlight: false });
      // Reconcile every observed active Session, not only the selected one. A missed terminal
      // notification otherwise leaves a background spinner stale indefinitely.
      const currentSessionId = useAppStore.getState().currentSessionId;
      requestObservedActiveLiveSnapshots({
        ...(currentSessionId !== null ? { excludeSessionId: currentSessionId } : {}),
      });
      revalidateCurrentSessionCanonicalPage();
    };
    let windowReconciliationActive = !document.hidden && document.hasFocus();
    const reconcileWindowActivation = (): void => {
      const active = !document.hidden && document.hasFocus();
      if (!active) {
        windowReconciliationActive = false;
        return;
      }
      if (windowReconciliationActive) return;
      windowReconciliationActive = true;
      flushSessionEventsIfActive();
    };
    // Foreground convergence guarantee (Issue 206): canonical truth must never depend on having
    // received every push. Whenever the window is visible, the current Session's newest canonical
    // page is revalidated on a bounded interval and on every focus edge — generation-fenced with
    // retainReadyProjection, so a healthy painted page is kept and a missed notification (lost
    // deltas/terminal/liveChanged) can only delay convergence to this tick, never require a
    // manual reload.
    const revalidateCurrentSessionCanonicalPage = (): void => {
      const state = useAppStore.getState();
      const sessionId = state.currentSessionId;
      if (!sessionId) return;
      const selected = state.sessions.find((session) => session.sessionId === sessionId);
      if (selected?.surface === 'partner') return;
      void revalidateNewestSessionHistory(
        sessionId,
        selected?.surface ?? 'code',
      ).catch((error: unknown) => {
        console.error('[session.history] foreground convergence revalidate failed', {
          sessionId,
          error,
        });
      });
    };
    const liveReconciliationTimer = setInterval(() => {
      if (document.hidden) return;
      requestRuntimeProfileSnapshot();
      const current = requestPeriodicCurrentCoderLiveSnapshot();
      requestObservedActiveLiveSnapshots({
        visibleOnly: true,
        ...(current !== undefined ? { excludeSessionId: current } : {}),
      });
      revalidateCurrentSessionCanonicalPage();
    }, 30_000);
    window.addEventListener('focus', reconcileWindowActivation);
    window.addEventListener('blur', reconcileWindowActivation);
    document.addEventListener('visibilitychange', reconcileWindowActivation);
    unsubsRef.current.push(
      bridge.on('runtime.connectionChanged', (connection) => {
        const previous = useAppStore.getState().runtimeConnection;
        setCoderRuntimeConnection(connection);
        const accepted = useAppStore.getState().runtimeConnection;
        if (accepted !== previous && shouldReconcileRuntimeConnection(previous, accepted)) {
          runtimeProfileBootstrapped = false;
          const currentSessionId = useAppStore.getState().currentSessionId;
          recoverCurrentSessionAtRuntimeEdge();
          requestObservedActiveLiveSnapshots({
            ...(currentSessionId !== null ? { excludeSessionId: currentSessionId } : {}),
          });
        }
      }),
      bridge.on('runtime.profileChanged', (profile) => {
        void acceptRuntimeProfile(profile);
      }),
      bridge.on('session.liveChanged', (change) => {
        const status = applySessionLiveProjectionChange(change);
        if (status === 'applied' && change.change.domain === 'run') {
          reconcileAuthoritativeTerminalHistory(change.sessionId);
        }
        if (shouldRequestSessionLiveSnapshot(status)) {
          requestLiveSnapshot(change.sessionId);
        }
      }),
      bridge.on('session.liveInvalidated', (invalidation) => {
        invalidateSessionLiveProjection(invalidation);
        requestLiveSnapshot(invalidation.sessionId);
      }),
      bridge.on('agent.actor.changed', (snapshot) => {
        replaceAgentActorSnapshot(snapshot);
      }),
    );
    const mountedConnection = useAppStore.getState().runtimeConnection;
    if (runtimeConnectionHasFreshLiveAuthority(mountedConnection)) {
      // This process-wide effect also rebuilds when i18n dependencies change. An older in-flight
      // snapshot is intentionally ignored after cleanup, so the new coordinator must seed the
      // selected Session again even when coderRuntimeReady itself did not transition.
      recoverCurrentSessionAtRuntimeEdge();
    }
    requestRuntimeProfileSnapshot();

    // Startup self-check plus explicit refreshes after mutable capability operations such as
    // user-confirmed sandbox setup. Reading space.version itself remains side-effect free.
    const refreshSpaceVersion = (): void => {
      void bridge.invoke('space.version', undefined).then((result) => {
        if (!disposed && result.ok) setVersion(result.data);
      });
    };
    window.addEventListener(SPACE_VERSION_REFRESH_EVENT, refreshSpaceVersion);
    refreshSpaceVersion();

    // FEATURE_004 启动时拉一次 provider 列表（main 已经把 keychain 中的 key 注入 env）
    bridge.invoke('provider.list', undefined).then((result) => {
      if (result.ok) {
        setProviders(
          result.data.providers,
          result.data.defaultProviderId,
          result.data.keychainBackend,
        );
      }
    });

    // v0.1.6 cleanup: 同时拉 ~/.kodax/config.json 的默认值（provider / model / thinking 等）
    // Space defaultProviderId 为 null 时 SessionList 会 fallback 到这里的 provider；
    // session 创建时也用这里的 reasoningMode / model 作为初值。失败静默 — 用 Space 自己的 default。
    bridge.invoke('kodax.getDefaults', {}).then((result) => {
      if (result.ok) {
        setKodaxDefaults(result.data);
      }
    });

    // v0.1.23: hydrate Space-owned runtime defaults, then migrate old LS pending values once.
    void bridge
      .invoke('settings.get', {})
      .then((result) => {
        if (!result.ok) return;
        const defaults = result.data.runtimeDefaults ?? {};
        setRuntimeDefaults(defaults);
        const state = useAppStore.getState();
        const patch: Partial<SpaceRuntimeDefaultsT> = {};

        if (defaults.reasoningMode !== undefined) setPendingReasoningMode(defaults.reasoningMode);
        else if (state.pendingReasoningMode !== null)
          patch.reasoningMode = state.pendingReasoningMode;

        if (defaults.permissionMode !== undefined)
          setPendingPermissionMode(defaults.permissionMode);
        else if (state.pendingPermissionMode !== null)
          patch.permissionMode = state.pendingPermissionMode;

        if (defaults.agentMode !== undefined) setPendingAgentMode(defaults.agentMode);
        else if (state.pendingAgentMode !== null) patch.agentMode = state.pendingAgentMode;

        if (Object.keys(patch).length === 0) return;
        void bridge
          .invoke('settings.setRuntimeDefaults', { runtimeDefaults: patch })
          .then((saved) => {
            if (!saved.ok) return;
            const next = saved.data.runtimeDefaults ?? {};
            setRuntimeDefaults(next);
            if (next.reasoningMode !== undefined) setPendingReasoningMode(next.reasoningMode);
            if (next.permissionMode !== undefined) setPendingPermissionMode(next.permissionMode);
            if (next.agentMode !== undefined) setPendingAgentMode(next.agentMode);
          })
          .catch(() => {});
      })
      .catch(() => {});

    // 启动期项目恢复 — 优先级：
    //   1. zustand store 已有 currentProjectPath（localStorage 持久化的 → store init 时就填上了）
    //   2. project.list 里 lastUsedAt 最新的 recent project（用户上次开过的真实目录）
    //   3. settings.defaultWorkspace 兜底（首次启动新用户）
    //
    // 之前直接走 defaultWorkspace，等同于"每次启动都打开默认 workspace"——用户在
    // KodaX-Space / 别的项目里干完活退出，下次开 Space 又跳回默认目录，体验差。
    // 现在按"最近用的"恢复，跟 VSCode / Claude Desktop / Cursor 等 IDE 一致。
    void (async () => {
      const listR = await bridge.invoke('project.list', undefined).catch(() => null);
      const projects = listR && listR.ok ? listR.data.projects : [];
      useAppStore.getState().setProjects(projects);

      // 已经有 currentProjectPath（localStorage 恢复 / 用户已操作）→ 不覆盖
      if (useAppStore.getState().currentProjectPath) return;

      // 优先用 recent 里 lastUsedAt 最新的
      if (projects.length > 0) {
        const mostRecent = projects.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a));
        useAppStore.getState().setCurrentProject(mostRecent.path);
        return;
      }

      // 一个 recent 都没有 → 真"首次启动"，落到 defaultWorkspace
      const settingsR = await bridge.invoke('settings.get', {}).catch(() => null);
      if (!settingsR || !settingsR.ok) return;
      const { defaultWorkspace } = settingsR.data;
      useAppStore.getState().setCurrentProject(defaultWorkspace);
      await bridge.invoke('project.recent.add', { path: defaultWorkspace }).catch(() => {});
      const refreshR = await bridge.invoke('project.list', undefined).catch(() => null);
      if (refreshR && refreshR.ok) useAppStore.getState().setProjects(refreshR.data.projects);
    })();

    // 全局 session.event 订阅——所有 session 共用这个监听，store 按 sessionId 路由
    unsubsRef.current.push(
      bridge.on('session.event', (event) => {
        if (
          sessionEventInvalidatesHistoryCache(event.kind) &&
          event.kind !== 'session_complete' &&
          event.kind !== 'session_error'
        ) {
          invalidateSessionHistoryPaging(event.sessionId);
        }
        sessionEventBatcher.push(event);
        if (event.kind === 'session_complete' || event.kind === 'session_error') {
          requestLiveSnapshot(event.sessionId);
        }
      }),
    );

    // F007: permission ask-and-wait — push 进队列，modal 渲染队列头
    unsubsRef.current.push(
      bridge.on('permission.request', (payload) => {
        enqueuePermission(payload);
      }),
    );

    // main 主动撤回（超时 / session 取消 / 关闭）— renderer 同步 dequeue 关弹窗
    unsubsRef.current.push(
      bridge.on('permission.cancelled', (payload) => {
        dequeuePermission(payload.reqId);
        // #5 fix: reason==='timeout' 之前是静默 dequeue——用户看不出弹窗为什么消失了，
        // 容易误以为自己点漏了。补一条 toast 说明是超时自动处理的。
        if (payload.reason === 'timeout') {
          pushToast(t('toast.permissionTimeout'), 'warning');
        }
      }),
    );

    // FEATURE_032: askUser ask-and-wait — push 进 askUser 队列，AskUserInlineStack 在对话流尾部渲染内联卡
    unsubsRef.current.push(
      bridge.on('askUser.request', (payload) => {
        enqueueAskUser(payload);
      }),
    );
    unsubsRef.current.push(
      bridge.on('askUser.cancelled', (payload) => {
        dequeueAskUser(payload.reqId);
        // #5 fix: 同 permission.cancelled——超时静默 dequeue 容易让用户困惑弹窗去哪了。
        if (payload.reason === 'timeout') {
          pushToast(t('toast.askUserTimeout'), 'warning');
        }
      }),
    );

    // Queue snapshot reads the SDK process-global MessageQueue. Space follow-up
    // prompts live there too, with Electron-side session ownership guards; enqueue/dequeue
    // ownership stays in main/SDK.
    bridge.invoke('kodax.queueGet', {}).then((r) => {
      if (r.ok) setQueueState(r.data.messages, r.data.totalSize);
    });
    unsubsRef.current.push(
      bridge.on('kodax.queueChanged', (payload) => {
        setQueueState(payload.snapshot, payload.totalSize);
      }),
    );

    // F060 Workflow Harness — 启动期播种已知 run，然后订阅 SDK 进程事件实时流（按 runId 覆盖式 upsert）。
    bridge
      .invoke('workflow.list', undefined)
      .then((r) => {
        if (r.ok) {
          // 只播种右侧栏的 run 列表。workflow 的结果/失败**通知**不再从这里按 wall-clock 重排回
          // transcript —— 改由 session.history 从 transcript 里 SDK 存的 `<task-completed>` 合成
          // 消息**原位**还原(见 ipc/session.ts)。原来那套侧存储重排在 SDK 压缩把 transcript
          // 时间戳压平后会乱序/置顶(治本待 SDK 逐条时间戳,见转交需求)。live 通知仍走 workflow.event。
          seedWorkflowRuns(r.data.runs);
        }
      })
      .catch(() => {
        /* best-effort 播种；失败由后续实时事件补齐 */
      });
    unsubsRef.current.push(
      bridge.on('workflow.event', (payload) => {
        upsertWorkflowRun(payload);
        if (payload.sessionId !== undefined && payload.surface !== 'partner') {
          for (const notice of formatWorkflowEventNotices(payload)) {
            sessionEventBatcher.push({
              kind: 'workflow_notice',
              sessionId: payload.sessionId,
              text: notice.text,
              ...(notice.key !== undefined ? { key: notice.key } : {}),
              ...(notice.sentAt !== undefined ? { sentAt: notice.sentAt } : {}),
            });
          }
        }
        if (
          payload.type === 'workflow_started' &&
          payload.sessionId !== undefined &&
          payload.surface !== 'partner' &&
          useAppStore.getState().currentSessionId === payload.sessionId
        ) {
          requestTaskDockFocus('workflow');
        }
      }),
    );
    // F065 子 agent 活动遥测——归到 run 的有界活动桶（不进主 transcript）。
    unsubsRef.current.push(
      bridge.on('workflow.activity', (payload) => {
        // Digest/activity only feeds the right-sidebar live activity strip. The durable
        // per-agent transcript summary comes solely from the snapshot item-summary path
        // (formatItemSummaryNotice, keyed + deduped) — the same source restore replays —
        // so the digest no longer emits a separate, keyless, duplicate transcript notice.
        appendWorkflowActivity(payload);
      }),
    );

    return () => {
      disposed = true;
      for (const u of unsubsRef.current) u();
      unsubsRef.current = [];
      // An i18n/dependency-driven effect rebuild can happen while snapshots are in flight. Preserve
      // every paused Session event before disposing this batcher; flush() intentionally skips them.
      for (const sessionId of liveSnapshotRequests) {
        sessionEventBatcher.drain(sessionId);
      }
      liveSnapshotRequests.clear();
      liveSnapshotActiveIntents.clear();
      liveSnapshotReruns.clear();
      for (const timer of liveSnapshotRetryTimers.values()) clearTimeout(timer);
      liveSnapshotRetryTimers.clear();
      liveSnapshotRetryAttempts.clear();
      clearRuntimeProfileRetry();
      clearInterval(liveReconciliationTimer);
      requestCoderLiveSnapshotRef.current = () => {};
      window.removeEventListener('focus', reconcileWindowActivation);
      window.removeEventListener('blur', reconcileWindowActivation);
      window.removeEventListener(SPACE_VERSION_REFRESH_EVENT, refreshSpaceVersion);
      document.removeEventListener('visibilitychange', reconcileWindowActivation);
      sessionEventBatcher.flush();
      sessionEventBatcher.dispose();
    };
  }, [
    t,
    appendEvent,
    enqueuePermission,
    dequeuePermission,
    enqueueAskUser,
    dequeueAskUser,
    setProviders,
    setKodaxDefaults,
    setRuntimeDefaults,
    setCoderRuntimeConnection,
    replaceRuntimeProfileProjection,
    replaceAgentActorSnapshot,
    replaceSessionLiveProjection,
    applySessionLiveProjectionChange,
    invalidateSessionLiveProjection,
    setPendingReasoningMode,
    setPendingPermissionMode,
    setPendingAgentMode,
    setQueueState,
    upsertWorkflowRun,
    seedWorkflowRuns,
    appendWorkflowActivity,
  ]);

  // Active work is snapshot-first. Its cumulative Runtime observation is the only source that can
  // restore an in-flight draft after reopening the Space window, so canonical history must not
  // block it and an older renderer projection must not suppress activation reconciliation.
  useEffect(() => {
    if (
      !window.kodaxSpace ||
      !currentSessionId ||
      !shouldBootstrapSelectedSessionLive({
        runtimeReady: coderRuntimeReady,
        needsObservation: currentSessionNeedsRuntimeObservation,
        hasImmediateActivity: currentSessionHasImmediateRuntimeActivity,
        historyAllowsObservation: false,
        hasLiveProjection: true,
      })
    ) {
      return;
    }
    const selected = useAppStore
      .getState()
      .sessions.find((session) => session.sessionId === currentSessionId);
    if (selected?.surface === 'partner') return;
    requestCoderLiveSnapshotRef.current(currentSessionId, {
      allowEqualHydration: true,
      rerunIfInFlight: false,
    });
  }, [
    coderRuntimeReady,
    currentSessionHasImmediateRuntimeActivity,
    currentSessionId,
    currentSessionNeedsRuntimeObservation,
  ]);

  // Idle history remains history-first to avoid head-of-line blocking its first canonical paint.
  useEffect(() => {
    if (
      !window.kodaxSpace ||
      !currentSessionId ||
      currentSessionHasImmediateRuntimeActivity ||
      !shouldBootstrapSelectedSessionLive({
        runtimeReady: coderRuntimeReady,
        needsObservation: currentSessionNeedsRuntimeObservation,
        hasImmediateActivity: false,
        historyAllowsObservation: currentSessionHistoryAllowsObservation,
        hasLiveProjection: hasCurrentLiveProjection,
      })
    ) {
      return;
    }
    const selected = useAppStore
      .getState()
      .sessions.find((session) => session.sessionId === currentSessionId);
    if (selected?.surface === 'partner') return;
    requestCoderLiveSnapshotRef.current(currentSessionId, {
      allowEqualHydration: true,
      rerunIfInFlight: false,
    });
  }, [
    coderRuntimeReady,
    currentSessionHasImmediateRuntimeActivity,
    currentSessionHistoryAllowsObservation,
    currentSessionId,
    currentSessionNeedsRuntimeObservation,
    hasCurrentLiveProjection,
  ]);

  // Actor telemetry has an independent Runtime cursor. Seed it explicitly on
  // renderer reload; subsequent changes arrive through agent.actor.changed.
  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (
      !bridge ||
      !currentSessionId ||
      !coderRuntimeReady ||
      !currentSessionHistoryAllowsObservation ||
      !currentSessionNeedsRuntimeObservation ||
      !hasCurrentLiveProjection ||
      hasCurrentActorSnapshot
    ) {
      return;
    }
    const state = useAppStore.getState();
    const selected = state.sessions.find((session) => session.sessionId === currentSessionId);
    if (selected?.surface === 'partner') return;
    let disposed = false;
    void invokeWithTimeout(
      bridge,
      'agent.actor.snapshot',
      { sessionId: currentSessionId },
      30_000,
    )
      .then((result) => {
        if (disposed) return;
        if (!result.ok) {
          console.warn('[agent.actor.snapshot] bootstrap failed', {
            sessionId: currentSessionId,
            error: result.error,
          });
          return;
        }
        replaceAgentActorSnapshot(result.data);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error('[agent.actor.snapshot] unexpected bootstrap failure', {
            sessionId: currentSessionId,
            error,
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    coderRuntimeReady,
    currentSessionHistoryAllowsObservation,
    currentSessionId,
    currentSessionNeedsRuntimeObservation,
    hasCurrentLiveProjection,
    hasCurrentActorSnapshot,
    replaceAgentActorSnapshot,
  ]);

  // (Esc 关 settings 面板已下放到 SettingsModal 自己 own —— 见 features/settings/SettingsModal.tsx)

  // OC-11: SystemNotice 的 "Provider settings" 按钮派发 CustomEvent —— 这里接住
  // 打开 Settings 模态，让 auth/quota 错误一键能跳转到改 key 的界面。
  useEffect(() => {
    const open = (): void => setShowSettings(true);
    window.addEventListener('kodax-space.open-provider-settings', open);
    return () => window.removeEventListener('kodax-space.open-provider-settings', open);
  }, []);

  // F018 Quick Ask global shortcut: Cmd+K (macOS) / Ctrl+K (others)
  // 跟 VSCode Quick Open / Slack / Linear 一致的 muscle memory。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowQuickAsk((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // F020 long-task complete OS notification — 在前台时不通知，>60s 任务才通知
  useSessionCompleteNotification();
  // F145 unread/action-required Sessions → native taskbar, Dock, or launcher badge.
  useAppBadgeCount();

  useEffect(() => {
    if (!currentSessionId) return;
    const markCurrentSessionRead = (): void => {
      if (document.hidden || !document.hasFocus()) return;
      setSessionFlag(currentSessionId, 'unread', false);
    };
    markCurrentSessionRead();
    window.addEventListener('focus', markCurrentSessionRead);
    document.addEventListener('visibilitychange', markCurrentSessionRead);
    return () => {
      window.removeEventListener('focus', markCurrentSessionRead);
      document.removeEventListener('visibilitychange', markCurrentSessionRead);
    };
  }, [currentSessionId, setSessionFlag]);

  // F020 notification click → main 推 'notification.clicked' 带 sessionId；
  // 这里订阅 push 通道，切到对应 session 让用户回到正在跑的对话。
  //
  // v0.1.3.1 修复（F020-H2）：notification 在 OS 通知中心可能存留几分钟到数小时，
  // 期间用户可能删了对应 session。点已删 session 会把 currentSessionId 写成一个不存在
  // 的 id，后续 Shell / ConversationStreamV2 读取时会 null-deref。检查 sessionId 仍存在
  // 才 setCurrentSession；否则静默丢弃（用户感知就是"点了通知没反应"，比白屏 crash 好）。
  const setCurrentSessionForNotif = useAppStore((s) => s.setCurrentSession);
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const unsub = window.kodaxSpace.on('notification.clicked', (payload) => {
      if (!payload.sessionId) return;
      const exists = useAppStore.getState().sessions.some((s) => s.sessionId === payload.sessionId);
      if (exists) setCurrentSessionForNotif(payload.sessionId);
    });
    return () => unsub();
  }, [setCurrentSessionForNotif]);

  // F021 v0.1.5 drag-drop install：把 .mcpb / .dxt 文件拖进 Space 主窗口即触发安装。
  // 走跟 "Install ext" 按钮同一条 IPC（mcpb.install + filePath）。
  // 不属于 mcpb 类的文件 → preventDefault 把浏览器默认 navigate-to-file 行为挡住，但不调 IPC。
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const onDragOver = (e: DragEvent): void => {
      // 必须 preventDefault 才会触发 drop 事件
      e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const f of Array.from(files)) {
        const name = f.name.toLowerCase();
        if (!name.endsWith('.mcpb') && !name.endsWith('.dxt')) continue;
        // Electron renderer 在 dropped File 上额外暴露 .path 字段（非标准 Web API）
        const filePath = (f as File & { path?: string }).path;
        if (typeof filePath !== 'string' || filePath.length === 0) continue;
        // fire-and-forget；main 端会用 native notification 给用户成功 / 失败反馈
        void window.kodaxSpace!.invoke('mcpb.install', { filePath });
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Settings overlay 仍 hoist 在这里；PermissionModal 由 Shell 内部 mount；askUser 走对话流内联卡（AskUserInline）。
  return (
    <>
      <Shell version={version} />
      {showSettings && (
        <SettingsModal initialTab="providers" onClose={() => setShowSettings(false)} />
      )}
      <QuickAskPopover open={showQuickAsk} onClose={() => setShowQuickAsk(false)} />
      <CompleteExitOverlay />
    </>
  );
}

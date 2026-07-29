export interface BeforeQuitState {
  readonly cleanupStarted: boolean;
  readonly daemonStopCommitted: boolean;
  readonly runtimeModeRestartScheduled: boolean;
  readonly secondaryInstanceExit: boolean;
}

/**
 * User and OS quit requests must enter the complete-exit gate on every desktop
 * platform. Only internal restarts and the losing single-instance process may
 * bypass daemon shutdown.
 */
export function shouldRequestCompleteExitOnBeforeQuit(state: BeforeQuitState): boolean {
  return (
    !state.cleanupStarted &&
    !state.daemonStopCommitted &&
    !state.runtimeModeRestartScheduled &&
    !state.secondaryInstanceExit
  );
}

export function daemonStopWasConfirmed(result: {
  readonly stopped: boolean;
  readonly reason?: string;
}): boolean {
  return result.stopped;
}

export interface SpaceExitWorkSnapshot {
  readonly runningSessions: number;
  readonly runningWorkflows: number;
  readonly pendingPermissions: number;
  readonly pendingUserInputs: number;
  readonly queuedPrompts: number;
  readonly activeExternalTasks: number;
}

/**
 * Space owns executable work that is not fully represented by the Coder daemon
 * stop preflight (notably Partner sessions and host-side workflow/agent work).
 * Keep these stable, bounded labels suitable for both dialogs and diagnostics.
 */
export function collectSpaceExitWorkBlockers(snapshot: SpaceExitWorkSnapshot): readonly string[] {
  const blockers: string[] = [];
  const append = (label: string, count: number): void => {
    if (Number.isSafeInteger(count) && count > 0) blockers.push(`${label}:${count}`);
  };
  append('space_sessions', snapshot.runningSessions);
  append('space_workflows', snapshot.runningWorkflows);
  append('space_permissions', snapshot.pendingPermissions);
  append('space_user_inputs', snapshot.pendingUserInputs);
  append('space_queued_prompts', snapshot.queuedPrompts);
  append('space_external_tasks', snapshot.activeExternalTasks);
  return blockers;
}

/**
 * Electron must register the relaunch synchronously before any quit path is
 * allowed to bypass complete-exit coordination. Delaying only requestQuit
 * avoids a window where the current process can exit before relaunch exists.
 */
export function commitRelaunchBeforeDelayedQuit(input: {
  readonly commitRelaunch: () => void;
  readonly markCommitted: () => void;
  readonly scheduleQuit: (callback: () => void, delayMs: number) => void;
  readonly requestQuit: () => void;
  readonly delayMs: number;
}): void {
  input.commitRelaunch();
  input.markCommitted();
  input.scheduleQuit(input.requestQuit, input.delayMs);
}

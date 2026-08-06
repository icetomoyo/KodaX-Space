export interface BeforeQuitState {
  readonly cleanupStarted: boolean;
  readonly daemonStopCommitted: boolean;
  readonly forcedExitCommitted: boolean;
  readonly runtimeModeRestartScheduled: boolean;
  readonly secondaryInstanceExit: boolean;
}

/**
 * User and OS quit requests must enter the complete-exit gate on every desktop
 * platform. Only an explicitly committed forced exit, internal restarts, and
 * the losing single-instance process may bypass daemon shutdown.
 */
export function shouldRequestCompleteExitOnBeforeQuit(state: BeforeQuitState): boolean {
  return (
    !state.cleanupStarted &&
    !state.daemonStopCommitted &&
    !state.forcedExitCommitted &&
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

export type BlockedCompleteExitAction = 'keep-open' | 'force-close';
export type FailedCompleteExitAction = BlockedCompleteExitAction | 'restart-recovery';

export function resolveBlockedCompleteExitAction(response: number): BlockedCompleteExitAction {
  return response === 1 ? 'force-close' : 'keep-open';
}

export function resolveFailedCompleteExitAction(
  response: number,
  restartRequired: boolean,
): FailedCompleteExitAction {
  const action = resolveBlockedCompleteExitAction(response);
  if (action === 'force-close') return action;
  return restartRequired ? 'restart-recovery' : 'keep-open';
}

export function shouldRetryDaemonStopAfterFailedCompleteExit(
  restartRequired: boolean,
): boolean {
  return !restartRequired;
}

/**
 * A forced exit is terminal even when the daemon was stopped successfully.
 * Runtime recovery is reserved for the ordinary safe-exit path, where losing
 * the control surface before daemon shutdown confirmation would strand work.
 */
export function shouldRecoverRuntimeAfterShutdownTimeout(state: {
  readonly forcedExitCommitted: boolean;
  readonly daemonStopCommitted: boolean;
}): boolean {
  return state.daemonStopCommitted && !state.forcedExitCommitted;
}

/**
 * Daemon-backed Coder Sessions are shared attachment points, not client-owned
 * execution identities. They must use Runtime's principal/run cancellation.
 */
export function shouldCancelSessionWideOnForcedExit(input: {
  readonly surface: 'code' | 'partner';
  readonly runtimeSelected: boolean;
}): boolean {
  return input.surface !== 'code' || !input.runtimeSelected;
}

/**
 * A ready daemon preflight is authoritative for daemon-backed Coder Runs. Local stream cleanup may
 * lag its terminal fact and must not create a false first-close blocker. Partner, Embedded, and an
 * unavailable Runtime remain locally fail-closed.
 */
export function shouldCountLocalSessionExitBlocker(input: {
  readonly surface: 'code' | 'partner';
  readonly runtimeSelected: boolean;
  readonly runtimeAuthorityReady: boolean;
}): boolean {
  return input.surface !== 'code' || !input.runtimeSelected || !input.runtimeAuthorityReady;
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
 * Keep the visible progress surface until daemon shutdown is authoritatively
 * verified. Hiding first makes a fail-closed cleanup look like Space quit and
 * then reopened. Once cleanup succeeds, hiding and committing are adjacent.
 */
export async function runAdmittedCompleteExit(input: {
  readonly hideControlSurface: () => void;
  readonly stopDaemon: () => Promise<void>;
  readonly commitExit: () => void;
}): Promise<void> {
  await input.stopDaemon();
  input.hideControlSurface();
  input.commitExit();
}

export interface ForcedCompleteExitResult {
  readonly ownedWorkStopCompleted: boolean;
  readonly daemonStopConfirmed: boolean;
  readonly failures: readonly unknown[];
}

/**
 * A user-confirmed force close is terminal for the Space process. Task and
 * daemon cleanup remain best-effort, but neither failure may put the user back
 * into an unclosable warning loop.
 */
export async function runForcedCompleteExit(input: {
  readonly hideControlSurface: () => void;
  readonly stopOwnedWork: () => Promise<void>;
  readonly tryStopDaemon: () => Promise<boolean>;
  readonly commitExit: (result: ForcedCompleteExitResult) => void;
}): Promise<ForcedCompleteExitResult> {
  input.hideControlSurface();
  const failures: unknown[] = [];
  let ownedWorkStopCompleted = false;
  let daemonStopConfirmed = false;
  try {
    await input.stopOwnedWork();
    ownedWorkStopCompleted = true;
  } catch (error) {
    failures.push(error);
  }
  try {
    daemonStopConfirmed = await input.tryStopDaemon();
  } catch (error) {
    failures.push(error);
  }
  const result: ForcedCompleteExitResult = {
    ownedWorkStopCompleted,
    daemonStopConfirmed,
    failures,
  };
  input.commitExit(result);
  return result;
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

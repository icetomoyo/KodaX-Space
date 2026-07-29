import type { CoderRuntimeModeT } from '@kodax-space/space-ipc-schema';

import type { RuntimeHostMode } from './runtime-host-adapter.js';
import {
  createCoderOwnerRecoveryRestartError,
  isCoderOwnerRecoveryRestartRequired,
} from './coder-owner-recovery-error.js';

export interface CoderRuntimeModeSwitchOptions<TSettings> {
  readonly target: CoderRuntimeModeT;
  readonly currentHost: RuntimeHostMode;
  readonly hasActiveSpaceRun: () => boolean | Promise<boolean>;
  readonly prepareEmbeddedRestart: () => Promise<void>;
  readonly prepareDaemonRestart: () => Promise<unknown>;
  readonly restoreDaemonOwner: () => Promise<unknown>;
  readonly persist: (mode: CoderRuntimeModeT) => Promise<TSettings>;
  readonly scheduleRestart: () => void;
}

export interface CoderRuntimeModeSwitchResult<TSettings> {
  readonly settings: TSettings;
  readonly restarting: boolean;
}

export interface CoderAdmissionOptions {
  readonly beginCoderAdmission?: () => () => void;
}

export async function runWithCoderAdmission<T>(
  options: CoderAdmissionOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const release = options.beginCoderAdmission?.() ?? (() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

export type CoderRuntimeModeSwitchCoordinatorOptions<TSettings> = Omit<
  CoderRuntimeModeSwitchOptions<TSettings>,
  'target' | 'currentHost'
> & {
  readonly currentHost: () => RuntimeHostMode;
};

function hostMatchesMode(host: RuntimeHostMode, mode: CoderRuntimeModeT): boolean {
  return (host === 'runtime' && mode === 'daemon') || (host === 'legacy' && mode === 'embedded');
}

export async function switchCoderRuntimeModeAndRestart<TSettings>(
  options: CoderRuntimeModeSwitchOptions<TSettings>,
): Promise<CoderRuntimeModeSwitchResult<TSettings>> {
  if (hostMatchesMode(options.currentHost, options.target)) {
    return {
      settings: await options.persist(options.target),
      restarting: false,
    };
  }
  if (await options.hasActiveSpaceRun()) {
    throw new Error('Coder mode can only be changed when no Space task is running.');
  }

  if (options.target === 'embedded') {
    try {
      await options.prepareEmbeddedRestart();
    } catch (prepareError) {
      if (isCoderOwnerRecoveryRestartRequired(prepareError)) options.scheduleRestart();
      throw prepareError;
    }
    let settings: TSettings;
    try {
      settings = await options.persist('embedded');
    } catch (persistError) {
      try {
        await options.restoreDaemonOwner();
      } catch (restoreError) {
        const restarting = isCoderOwnerRecoveryRestartRequired(restoreError);
        if (restarting) options.scheduleRestart();
        throw new AggregateError(
          [persistError, restoreError],
          restarting
            ? 'Space could not save embedded mode or restore daemon ownership. A recovery restart is in progress.'
            : 'Coder entered embedded mode, but Space could not save the preference or restore daemon mode.',
        );
      }
      options.scheduleRestart();
      throw new AggregateError(
        [persistError],
        'Space could not save embedded mode. Daemon mode was restored and Space is restarting.',
      );
    }
    options.scheduleRestart();
    return { settings, restarting: true };
  }

  const settings = await options.persist('daemon');
  try {
    await options.prepareDaemonRestart();
  } catch (prepareError) {
    const restarting = isCoderOwnerRecoveryRestartRequired(prepareError);
    try {
      await options.persist('embedded');
    } catch (restoreError) {
      // The disk preference may still say daemon while the process retained an
      // inline owner. Startup reconciliation can repair that state, but this
      // process must not reopen admission before the recovery restart.
      const recoveryError = createCoderOwnerRecoveryRestartError(
        [prepareError, restoreError],
        'Space could not enable daemon mode or restore the embedded preference. ' +
          'A recovery restart is in progress.',
      );
      options.scheduleRestart();
      throw recoveryError;
    }
    if (restarting) options.scheduleRestart();
    throw prepareError;
  }
  options.scheduleRestart();
  return { settings, restarting: true };
}

type CoderRuntimeModeSwitchState = 'idle' | 'switching' | 'restarting' | 'shutting_down';

/**
 * Serializes runtime-mode changes with Coder request admission.
 *
 * A caller that can create, send, queue, launch, or resume executable Coder work
 * must enter through runCoderAdmission(). Read-only lazy session hydration does
 * not need admission because it does not acquire the Coder owner or start work.
 * Mode switching closes the gate synchronously, drains already-admitted work,
 * and only then checks for active runs. Successful owner transitions keep the
 * gate closed until the scheduled process restart.
 */
export class CoderRuntimeModeSwitchCoordinator<TSettings> {
  private state: CoderRuntimeModeSwitchState = 'idle';
  private activeAdmissions = 0;
  private readonly admissionDrainWaiters = new Set<() => void>();

  constructor(private readonly options: CoderRuntimeModeSwitchCoordinatorOptions<TSettings>) {}

  beginCoderAdmission(): () => void {
    if (this.state !== 'idle') {
      throw new Error(
        'Coder runtime mode is switching or Space is restarting. Retry after Space restarts.',
      );
    }
    this.activeAdmissions += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeAdmissions -= 1;
      if (this.activeAdmissions === 0) {
        for (const resolve of this.admissionDrainWaiters) resolve();
        this.admissionDrainWaiters.clear();
      }
    };
  }

  async runCoderAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const release = this.beginCoderAdmission();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Closes Coder admission before application-exit preflight. The returned
   * callback reopens admission when exit is cancelled or blocked. A committed
   * exit deliberately keeps the gate closed until the process terminates.
   */
  async beginShutdown(options: { readonly drainTimeoutMs?: number } = {}): Promise<() => void> {
    if (this.state !== 'idle') {
      throw new Error('Coder runtime mode is switching or Space is already shutting down.');
    }
    this.state = 'shutting_down';
    try {
      await this.waitForAdmissionsToDrain(options.drainTimeoutMs);
    } catch (error) {
      if (this.state === 'shutting_down') this.state = 'idle';
      throw error;
    }
    let reopened = false;
    return () => {
      if (reopened) return;
      reopened = true;
      if (this.state === 'shutting_down') this.state = 'idle';
    };
  }

  async switchMode(target: CoderRuntimeModeT): Promise<CoderRuntimeModeSwitchResult<TSettings>> {
    if (this.state !== 'idle') {
      throw new Error('A Coder runtime mode switch is already in progress.');
    }

    // This assignment is deliberately synchronous. No new Coder admission can
    // enter between the switch request and the active-run safety check.
    this.state = 'switching';
    try {
      await this.waitForAdmissionsToDrain();
      const result = await switchCoderRuntimeModeAndRestart({
        ...this.options,
        target,
        currentHost: this.options.currentHost(),
        scheduleRestart: () => this.scheduleRestart(),
      });
      if (!result.restarting) this.state = 'idle';
      return result;
    } catch (error) {
      // Recovery from a partially completed owner transition may itself require
      // a restart. In that case scheduleRestart() has already closed the gate
      // permanently for this process.
      if (isCoderOwnerRecoveryRestartRequired(error) && !this.restartIsScheduled()) {
        this.scheduleRestart();
      }
      if (!this.restartIsScheduled()) this.state = 'idle';
      throw error;
    }
  }

  private restartIsScheduled(): boolean {
    return this.state === 'restarting';
  }

  private waitForAdmissionsToDrain(timeoutMs?: number): Promise<void> {
    if (this.activeAdmissions === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const complete = (): void => {
        this.admissionDrainWaiters.delete(complete);
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      this.admissionDrainWaiters.add(complete);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.admissionDrainWaiters.delete(complete);
          reject(
            new Error(
              `Coder shutdown admission drain did not finish within ${timeoutMs} ms. Space will remain open.`,
            ),
          );
        }, timeoutMs);
      }
    });
  }

  private scheduleRestart(): void {
    this.state = 'restarting';
    try {
      this.options.scheduleRestart();
    } catch (error) {
      this.state = 'switching';
      throw error;
    }
  }
}

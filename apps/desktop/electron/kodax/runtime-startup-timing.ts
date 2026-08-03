import { getDiagnosticsLogger } from '../diagnostics/runtime.js';

/** Opt in with `KODAX_SPACE_RUNTIME_STARTUP_DEBUG=1`; every other value is disabled. */
export const RUNTIME_STARTUP_DEBUG_ENV = 'KODAX_SPACE_RUNTIME_STARTUP_DEBUG';

export type RuntimeStartupTimingPhase = 'start' | 'complete' | 'failed' | 'skipped';

export interface RuntimeStartupTimingEvent {
  readonly attemptId: string;
  readonly scope: string;
  readonly stage: string;
  readonly phase: RuntimeStartupTimingPhase;
  readonly stepMs: number;
  readonly totalMs: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface RuntimeStartupTimingRecorder {
  readonly enabled: boolean;
  mark(
    stage: string,
    phase?: RuntimeStartupTimingPhase,
    data?: Readonly<Record<string, unknown>>,
  ): void;
}

export type RuntimeStartupTimingSink = (event: RuntimeStartupTimingEvent) => void;
export type RuntimeStartupTimingFactory = (scope: string) => RuntimeStartupTimingRecorder;

interface RuntimeStartupTimingOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  readonly sink?: RuntimeStartupTimingSink;
  readonly attemptId?: string;
}

let nextAttempt = 0;

export function isRuntimeStartupDebugEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[RUNTIME_STARTUP_DEBUG_ENV] === '1';
}

function roundedDuration(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}

function defaultSink(event: RuntimeStartupTimingEvent): void {
  getDiagnosticsLogger()?.debug('runtime-startup', 'stage_timing', undefined, event);
}

export function createRuntimeStartupTiming(
  scope: string,
  options: RuntimeStartupTimingOptions = {},
): RuntimeStartupTimingRecorder {
  const enabled = isRuntimeStartupDebugEnabled(options.env);
  if (!enabled) {
    return {
      enabled: false,
      mark: () => undefined,
    };
  }

  const now = options.now ?? (() => Number(process.hrtime.bigint()) / 1_000_000);
  const sink = options.sink ?? defaultSink;
  const attemptId =
    options.attemptId ?? `${scope}-${process.pid}-${String(++nextAttempt).padStart(3, '0')}`;
  const startedAt = now();
  let previousAt = startedAt;

  return {
    enabled: true,
    mark(stage, phase = 'complete', data) {
      const currentAt = now();
      try {
        sink({
          attemptId,
          scope,
          stage,
          phase,
          stepMs: roundedDuration(currentAt - previousAt),
          totalMs: roundedDuration(currentAt - startedAt),
          ...(data === undefined ? {} : { data }),
        });
      } catch {
        // Diagnostics must never make Runtime startup fail or slow its recovery path.
      }
      previousAt = currentAt;
    },
  };
}

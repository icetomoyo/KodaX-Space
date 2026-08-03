export interface BackgroundRuntimeStartupOptions {
  readonly initialize: () => Promise<void>;
  readonly onReady?: () => void;
  readonly onFailure?: (error: unknown) => void;
}

function notify(observer: (() => void) | undefined): void;
function notify(observer: ((error: unknown) => void) | undefined, error: unknown): void;
function notify(observer: ((error?: unknown) => void) | undefined, error?: unknown): void {
  try {
    observer?.(error);
  } catch {
    // Logging/diagnostic observers must never turn a settled background Runtime
    // result into an unhandled rejection or change whether dependent work runs.
  }
}

/**
 * Start the expensive Runtime attachment without making it a renderer-startup
 * dependency. The boolean result lets dependent background work run only when
 * the shared Runtime is actually ready, while initialization failures remain
 * non-fatal for the rest of Space.
 */
export function startBackgroundRuntimeInitialization(
  options: BackgroundRuntimeStartupOptions,
): Promise<boolean> {
  let initialization: Promise<void>;
  try {
    initialization = options.initialize();
  } catch (error: unknown) {
    notify(options.onFailure, error);
    return Promise.resolve(false);
  }

  return initialization.then(
    () => {
      notify(options.onReady);
      return true;
    },
    (error: unknown) => {
      notify(options.onFailure, error);
      return false;
    },
  );
}

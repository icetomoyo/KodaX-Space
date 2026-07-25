import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { partnerEvidenceLocatorSchema } from '@kodax-space/space-ipc-schema';
import {
  isPartnerSourceExtractionFormat,
  MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS,
  MAX_PARTNER_SOURCE_EVIDENCE_UNITS,
  MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS,
  MAX_PARTNER_SOURCE_EXTRACTION_ERROR_CHARS,
  PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION,
  type PartnerSourceExtractionFormat,
  type PartnerSourceExtractionResult,
  type PartnerSourceExtractionWorkerRequest,
  type PartnerSourceExtractionWorkerResponse,
} from './partner-source-extraction-protocol.js';

const DEFAULT_EXTRACTION_TIMEOUT_MS = 15_000;
const SUCCESSFUL_WORKER_EXIT_GRACE_MS = 1_000;
const EXTRACTION_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
});

export interface PartnerSourceExtractionRunnerOptions {
  /** Test-only override; production always resolves the packaged sidecar next to main.js. */
  readonly workerEntrypoint?: string | URL;
  /** Test-only deadline override. */
  readonly timeoutMs?: number;
  /** Cancels the isolated worker without allowing a partial extraction result. */
  readonly signal?: AbortSignal;
}

interface ResolvedWorkerEntrypoint {
  readonly value: string | URL;
  readonly sourceTypeScript: boolean;
}

function defaultWorkerEntrypoint(): ResolvedWorkerEntrypoint {
  if (typeof __dirname === 'string') {
    return {
      value: join(__dirname, 'partner-source-extraction-worker.js'),
      sourceTypeScript: false,
    };
  }
  return {
    value: new URL('./partner-source-extraction-worker.ts', import.meta.url),
    sourceTypeScript: true,
  };
}

function resolveWorkerEntrypoint(override: string | URL | undefined): ResolvedWorkerEntrypoint {
  if (override === undefined) return defaultWorkerEntrypoint();
  const pathname = override instanceof URL ? override.pathname : override;
  return { value: override, sourceTypeScript: pathname.endsWith('.ts') };
}

function sourceTypeScriptWorkerBootstrap(entrypoint: string | URL): URL {
  // Node 20 resolves a Worker's entrypoint format before --import hooks can
  // teach it about .ts. Start from plain ESM and let tsx import the source
  // sidecar explicitly; packaged builds continue to launch compiled JS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  const tsxApiUrl = pathToFileURL(req.resolve('tsx/esm/api')).href;
  const sourceUrl = entrypoint instanceof URL ? entrypoint.href : pathToFileURL(entrypoint).href;
  const source =
    `import { tsImport } from ${JSON.stringify(tsxApiUrl)};` +
    `await tsImport(${JSON.stringify(sourceUrl)}, import.meta.url);`;
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function extractionTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_EXTRACTION_TIMEOUT_MS;
  if (!Number.isFinite(value)) throw new Error('extraction worker timeout must be finite');
  return Math.max(1, Math.min(Math.trunc(value), 60_000));
}

function transferableBytes(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function extractionWorkerEnv(sourceTypeScript: boolean): NodeJS.Dict<string> {
  if (!sourceTypeScript) return {};
  // Source-mode tests load the sidecar through tsx. Keep its compiler cache in
  // the OS temp directory without exposing the parent process environment; an
  // empty env makes tsx resolve its cache under a literal workspace/undefined/.
  const temp = tmpdir();
  return {
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    LOCALAPPDATA: temp,
    XDG_CACHE_HOME: temp,
  };
}

function parseWorkerResponse(
  value: unknown,
  expectedFormat: PartnerSourceExtractionFormat,
): PartnerSourceExtractionWorkerResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('extraction worker returned an invalid response');
  }
  const response = value as Partial<PartnerSourceExtractionWorkerResponse>;
  if (response.version !== PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION) {
    throw new Error('extraction worker returned an incompatible response');
  }
  if (
    response.ok === true &&
    isPartnerSourceExtractionFormat(response.format) &&
    response.format === expectedFormat &&
    typeof response.text === 'string' &&
    response.text.length <= MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS &&
    Array.isArray(response.units) &&
    response.units.length <= MAX_PARTNER_SOURCE_EVIDENCE_UNITS &&
    response.units.every(
      (unit, ordinal) =>
        Boolean(unit) &&
        typeof unit === 'object' &&
        typeof unit.id === 'string' &&
        /^unit_[A-Za-z0-9_-]{8,}$/.test(unit.id) &&
        unit.ordinal === ordinal &&
        typeof unit.text === 'string' &&
        unit.text.length > 0 &&
        unit.text.length <= MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS &&
        partnerEvidenceLocatorSchema.safeParse(unit.locator).success,
    ) &&
    Array.isArray(response.warnings) &&
    response.warnings.length <= 32 &&
    response.warnings.every((warning) => typeof warning === 'string' && warning.length <= 300)
  ) {
    return response as Extract<PartnerSourceExtractionWorkerResponse, { ok: true }>;
  }
  if (
    response.ok === false &&
    typeof response.error === 'string' &&
    response.error.length <= MAX_PARTNER_SOURCE_EXTRACTION_ERROR_CHARS
  ) {
    return response as Extract<PartnerSourceExtractionWorkerResponse, { ok: false }>;
  }
  throw new Error('extraction worker returned an invalid response');
}

/**
 * Run one document parser in one V8 isolate. The promise settles only after the
 * worker has exited or terminate() has completed, including error and timeout paths.
 */
export function runPartnerSourceStructuredExtractionWorker(
  format: PartnerSourceExtractionFormat,
  bytes: Buffer,
  options: PartnerSourceExtractionRunnerOptions = {},
): Promise<PartnerSourceExtractionResult> {
  const entrypoint = resolveWorkerEntrypoint(options.workerEntrypoint);
  const timeoutMs = extractionTimeout(options.timeoutMs);
  const ownedBytes = transferableBytes(bytes);
  const request: PartnerSourceExtractionWorkerRequest = {
    version: PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION,
    format,
    bytes: ownedBytes,
  };

  if (options.signal?.aborted) {
    return Promise.reject(
      Object.assign(new Error('Partner source extraction was cancelled'), {
        code: 'INGESTION_CANCELLED',
      }),
    );
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      const workerEntrypoint = entrypoint.sourceTypeScript
        ? sourceTypeScriptWorkerBootstrap(entrypoint.value)
        : entrypoint.value;
      worker = new Worker(workerEntrypoint, {
        workerData: request,
        transferList: [ownedBytes],
        argv: [],
        env: extractionWorkerEnv(entrypoint.sourceTypeScript),
        execArgv: [],
        resourceLimits: EXTRACTION_WORKER_RESOURCE_LIMITS,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let finalizing = false;
    let deadline: NodeJS.Timeout | undefined;
    let onAbort: () => void = () => undefined;

    const clearPendingControls = (): void => {
      if (deadline) clearTimeout(deadline);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finishWithTermination = (
      outcome:
        | { readonly kind: 'resolve'; readonly result: PartnerSourceExtractionResult }
        | { readonly kind: 'reject'; readonly error: Error },
    ): void => {
      if (finalizing) return;
      finalizing = true;
      clearPendingControls();
      void worker.terminate().then(
        () => {
          if (outcome.kind === 'resolve') resolve(outcome.result);
          else reject(outcome.error);
        },
        (terminationError: unknown) => {
          reject(
            terminationError instanceof Error
              ? terminationError
              : new Error('failed to terminate extraction worker'),
          );
        },
      );
    };

    const finishAfterNaturalExit = (
      outcome:
        | { readonly kind: 'resolve'; readonly result: PartnerSourceExtractionResult }
        | { readonly kind: 'reject'; readonly error: Error },
    ): void => {
      if (finalizing) return;
      finalizing = true;
      clearPendingControls();

      let settled = false;
      let forcedTermination = false;
      const settle = (
        finalOutcome:
          | { readonly kind: 'resolve'; readonly result: PartnerSourceExtractionResult }
          | { readonly kind: 'reject'; readonly error: Error },
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(exitGrace);
        if (finalOutcome.kind === 'resolve') resolve(finalOutcome.result);
        else reject(finalOutcome.error);
      };
      const exitGrace = setTimeout(() => {
        forcedTermination = true;
        void worker.terminate().then(
          () => settle(outcome),
          (terminationError: unknown) =>
            settle({
              kind: 'reject',
              error:
                terminationError instanceof Error
                  ? terminationError
                  : new Error('failed to terminate extraction worker'),
            }),
        );
      }, SUCCESSFUL_WORKER_EXIT_GRACE_MS);
      exitGrace.unref?.();
      worker.once('exit', (code) => {
        if (forcedTermination) return;
        if (code === 0) settle(outcome);
        else
          settle({
            kind: 'reject',
            error: new Error(`extraction worker exited after returning a result (code ${code})`),
          });
      });
    };

    onAbort = (): void => {
      finishWithTermination({
        kind: 'reject',
        error: Object.assign(new Error('Partner source extraction was cancelled'), {
          code: 'INGESTION_CANCELLED',
        }),
      });
    };

    worker.once('message', (rawResponse: unknown) => {
      try {
        const response = parseWorkerResponse(rawResponse, format);
        if (response.ok) {
          finishAfterNaturalExit({
            kind: 'resolve',
            result: {
              text: response.text,
              units: response.units,
              warnings: response.warnings,
            },
          });
        } else finishAfterNaturalExit({ kind: 'reject', error: new Error(response.error) });
      } catch (error) {
        finishWithTermination({
          kind: 'reject',
          error: error instanceof Error ? error : new Error('invalid extraction worker response'),
        });
      }
    });
    worker.once('error', (error) => finishWithTermination({ kind: 'reject', error }));
    worker.once('exit', (code) => {
      if (finalizing) return;
      finishWithTermination({
        kind: 'reject',
        error: new Error(`extraction worker exited before returning a result (code ${code})`),
      });
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });

    deadline = setTimeout(() => {
      finishWithTermination({
        kind: 'reject',
        error: new Error(`extraction worker exceeded its ${timeoutMs} ms hard deadline`),
      });
    }, timeoutMs);
  });
}

/** Compatibility view used by the existing explicit Partner source tool. */
export async function runPartnerSourceExtractionWorker(
  format: PartnerSourceExtractionFormat,
  bytes: Buffer,
  options: PartnerSourceExtractionRunnerOptions = {},
): Promise<string> {
  return (await runPartnerSourceStructuredExtractionWorker(format, bytes, options)).text;
}

import type { AutoModeDecisionDiagnostics } from '@kodax-space/space-ipc-schema';
import { autoModeDecisionDiagnosticsSchema } from '@kodax-space/space-ipc-schema';
import { sanitizeForDisplay, sanitizeInputForDisplay } from './sanitize.js';

const SOURCES = new Set([
  'classifier_confirm',
  'classifier_failure',
  'classifier_circuit_breaker',
  'configuration',
]);
const FAILURE_KINDS = new Set(['timeout', 'provider_error', 'contract_error', 'input_budget']);
const OUTCOMES = new Set([
  'allow',
  'confirm',
  'timeout',
  'provider_error',
  'contract_error',
  'input_budget',
]);
const OBSERVED_PROTOCOLS = new Set(['structured_v2', 'legacy_v1', 'unknown']);
const PARSE_FAILURE_CODES = new Set([
  'missing_decision',
  'invalid_decision',
  'ambiguous_decision',
  'missing_hazard',
  'invalid_hazard',
  'decision_hazard_conflict',
  'decision_reason_conflict',
  'missing_reason',
  'structured_format_violation',
  'legacy_format_violation',
  'tool_use',
]);
const OUTPUT_WARNING_CODES = new Set([
  'missing_hazard',
  'invalid_hazard',
  'decision_hazard_conflict',
  'decision_reason_conflict',
  'missing_reason',
  'structured_format_violation',
  'legacy_format_violation',
]);
const TERMINAL_PHASES = new Set([
  'completed',
  'pre_output',
  'awaiting_text',
  'thinking',
  'streaming',
  'contract_error',
]);
const MAX_WARNING_CANDIDATES = 64;
const MAX_ENUM_VALUE_LENGTH = 64;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function enumValue(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && value.length <= MAX_ENUM_VALUE_LENGTH && allowed.has(value)
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown, maximum?: number): number | undefined {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return undefined;
  const numeric = Number(value);
  return maximum === undefined || numeric <= maximum ? numeric : undefined;
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  const numeric = nonNegativeInteger(value, maximum);
  return numeric !== undefined && numeric > 0 ? numeric : undefined;
}

function diagnosticText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  // Bound untrusted Runtime strings before running credential redaction regexes.
  // A small scan window allows leading invisible/control characters to be removed
  // without making work proportional to an arbitrarily large malformed field.
  const bounded = value.slice(0, maximum * 4);
  const sanitized = sanitizeInputForDisplay({ value: bounded })?.value;
  if (typeof sanitized !== 'string') return '';
  // sanitizeForDisplay trims by Unicode scalars, while zod string bounds count
  // UTF-16 code units: an emoji-heavy field at 512 scalars can reach ~1024 code
  // units and make the whole strict diagnostics object unparseable. Clamp by
  // code units last so free-text fields (e.g. classifier reason) never do that.
  const text = sanitizeForDisplay(sanitized, maximum);
  return text.length > maximum ? text.slice(0, maximum) : text;
}

function projectProviderDiagnostics(value: unknown): Record<string, unknown> | undefined {
  const input = record(value);
  if (!input) return undefined;
  const provider = diagnosticText(input.provider, 128);
  const model = diagnosticText(input.model, 256);
  const timeoutMs = nonNegativeInteger(input.timeoutMs);
  const elapsedMs = nonNegativeInteger(input.elapsedMs);
  const promptBytes = nonNegativeInteger(input.promptBytes);
  const retryCount = nonNegativeInteger(input.retryCount, 16);
  const retryWaitMs = nonNegativeInteger(input.retryWaitMs);
  const terminalPhase = enumValue(input.terminalPhase, TERMINAL_PHASES);
  if (
    !provider ||
    !model ||
    timeoutMs === undefined ||
    elapsedMs === undefined ||
    promptBytes === undefined ||
    retryCount === undefined ||
    retryWaitMs === undefined ||
    terminalPhase === undefined
  )
    return undefined;
  return {
    provider,
    model,
    timeoutMs,
    elapsedMs,
    promptBytes,
    retryCount,
    retryWaitMs,
    terminalPhase,
  };
}

/**
 * Convert SDK/Runtime Auto[LLM] metadata into Space's bounded display contract.
 * Unknown future values are omitted locally rather than rejecting the entire
 * permission request; no prompt or raw classifier response is accepted here.
 */
export function projectAutoModeDiagnostics(
  value: unknown,
): AutoModeDecisionDiagnostics | undefined {
  const input = record(value);
  if (!input) return undefined;
  const source = enumValue(input.source, SOURCES);
  if (!source) return undefined;

  const attempts = Array.isArray(input.classifierAttempts)
    ? input.classifierAttempts.slice(0, 4).flatMap((candidate) => {
        const attemptInput = record(candidate);
        if (!attemptInput) return [];
        const attempt = positiveInteger(attemptInput.attempt, 4);
        const outcome = enumValue(attemptInput.outcome, OUTCOMES);
        if (attempt === undefined || !outcome) return [];
        const diagnostics = projectProviderDiagnostics(attemptInput.diagnostics);
        const observedProtocol = enumValue(attemptInput.observedProtocol, OBSERVED_PROTOCOLS);
        const parseFailureCode = enumValue(attemptInput.parseFailureCode, PARSE_FAILURE_CODES);
        const outputWarnings = Array.isArray(attemptInput.outputWarnings)
          ? [
              ...new Set(
                attemptInput.outputWarnings
                  .slice(0, MAX_WARNING_CANDIDATES)
                  .filter(
                    (warning): warning is string =>
                      typeof warning === 'string' &&
                      warning.length <= MAX_ENUM_VALUE_LENGTH &&
                      OUTPUT_WARNING_CODES.has(warning),
                  ),
              ),
            ].slice(0, 16)
          : [];
        return [
          {
            attempt,
            outcome,
            ...(diagnostics ? { diagnostics } : {}),
            ...(observedProtocol ? { observedProtocol } : {}),
            ...(parseFailureCode ? { parseFailureCode } : {}),
            ...(outputWarnings.length > 0 ? { outputWarnings } : {}),
          },
        ];
      })
    : [];
  const classifierFailureKind = enumValue(input.classifierFailureKind, FAILURE_KINDS);
  const reason = diagnosticText(input.reason, 512);
  const projected = {
    source,
    ...(reason ? { reason } : {}),
    ...(classifierFailureKind ? { classifierFailureKind } : {}),
    ...(attempts.length > 0 ? { classifierAttempts: attempts } : {}),
  };
  const parsed = autoModeDecisionDiagnosticsSchema.safeParse(projected);
  return parsed.success ? parsed.data : undefined;
}

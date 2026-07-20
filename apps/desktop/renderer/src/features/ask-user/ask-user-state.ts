export interface AskUserInteractionIdentity {
  readonly requestId: string | null;
  readonly kind: 'guardrail' | 'input' | 'select';
  readonly multiQuestionIndex: number;
  readonly question: unknown;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Readonly<Record<string, unknown>>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) result[key] = canonicalize(source[key]);
  }
  return result;
}

/**
 * Stable semantic identity for the currently displayed question.
 *
 * Daemon projection refreshes deserialize a new payload object even when the
 * request itself did not change. React object identity therefore cannot be used
 * as the reset signal for in-progress selections.
 */
export function buildAskUserInteractionKey(identity: AskUserInteractionIdentity): string {
  return JSON.stringify(canonicalize(identity));
}

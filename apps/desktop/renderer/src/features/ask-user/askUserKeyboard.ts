export type AskUserCardKind = 'guardrail' | 'input' | 'select';

export type AskUserKeyboardAction =
  | { readonly type: 'ignore' }
  | { readonly type: 'allow' }
  | { readonly type: 'block' }
  | { readonly type: 'submit' }
  | { readonly type: 'cancel' }
  | { readonly type: 'select-option'; readonly index: number };

interface AskUserCardKeyInput {
  readonly key: string;
  readonly kind: AskUserCardKind;
  readonly focusedButton: boolean;
  readonly keyboardOptionCount: number;
}

export function resolveAskUserCardKey(input: AskUserCardKeyInput): AskUserKeyboardAction {
  if (input.key === 'Enter') {
    if (input.focusedButton) return { type: 'ignore' };
    return { type: input.kind === 'guardrail' ? 'allow' : 'submit' };
  }
  if (input.key === 'Escape') {
    return { type: input.kind === 'guardrail' ? 'block' : 'cancel' };
  }
  if (input.kind !== 'select') return { type: 'ignore' };
  const digit = Number(input.key);
  if (!Number.isInteger(digit) || digit < 1 || digit > input.keyboardOptionCount) {
    return { type: 'ignore' };
  }
  return { type: 'select-option', index: digit - 1 };
}

export function resolveAskUserTextInputKey(input: {
  readonly key: string;
  readonly controlOrMeta: boolean;
}): AskUserKeyboardAction {
  if (input.key === 'Escape') return { type: 'cancel' };
  if (input.key === 'Enter' && input.controlOrMeta) return { type: 'submit' };
  return { type: 'ignore' };
}

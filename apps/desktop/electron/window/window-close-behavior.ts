import type { WindowCloseBehaviorT } from '@kodax-space/space-ipc-schema';

export type WindowCloseAction = 'allow-close' | 'prompt' | 'minimize-to-tray' | 'quit-completely';

export type WindowClosePromptAction =
  | Exclude<WindowCloseAction, 'allow-close' | 'prompt'>
  | 'cancel';

export interface WindowClosePromptResult {
  readonly response: number;
  readonly checkboxChecked: boolean;
}

export type ParsedWindowClosePromptResult =
  | {
      readonly action: 'minimize-to-tray' | 'quit-completely';
      readonly rememberedBehavior?: Exclude<WindowCloseBehaviorT, 'ask'>;
    }
  | { readonly action: 'cancel' };

export function resolveWindowCloseAction(
  behavior: WindowCloseBehaviorT,
  hasUsableTray: boolean,
): WindowCloseAction {
  if (!hasUsableTray) return 'allow-close';
  if (behavior === 'ask') return 'prompt';
  return behavior;
}

export function parseWindowClosePromptResult(
  result: WindowClosePromptResult,
): ParsedWindowClosePromptResult {
  const action =
    result.response === 0
      ? 'minimize-to-tray'
      : result.response === 1
        ? 'quit-completely'
        : 'cancel';
  if (action === 'cancel') return { action };
  if (!result.checkboxChecked) return { action };
  return { action, rememberedBehavior: action };
}

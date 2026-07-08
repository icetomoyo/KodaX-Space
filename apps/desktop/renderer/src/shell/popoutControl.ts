import type { PopoutKind } from './CommandToolbar.js';

export const SHELL_POPOUT_EVENT = 'kodax-space.shell-popout';

export interface ShellPopoutRequest {
  readonly kind: PopoutKind | null;
}

const POPOUT_KINDS: readonly PopoutKind[] = [
  'files',
  'preview',
  'diff',
  'terminal',
  'tasks',
  'plan',
  'agents',
  'mcp',
  'memory',
  'artifact',
  'workflow',
];

export function isPopoutKind(value: string | null | undefined): value is PopoutKind {
  return typeof value === 'string' && (POPOUT_KINDS as readonly string[]).includes(value);
}

export function requestShellPopout(kind: PopoutKind | null): void {
  window.dispatchEvent(
    new CustomEvent<ShellPopoutRequest>(SHELL_POPOUT_EVENT, {
      detail: { kind },
    }),
  );
}

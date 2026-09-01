import type { PermissionMode } from '@kodax-space/space-ipc-schema';

/**
 * The embedded KodaX path must have exactly one permission decision owner.
 *
 * When Auto's SDK guardrail was installed for the current run, it has already
 * reviewed the tool call before `beforeToolExecute` runs. Sending the same call
 * through Space's legacy broker would turn its static risk assessment into a
 * second approval gate. If bootstrap did not complete, the broker remains the
 * fallback under Edits policy so Auto cannot fail open.
 */
export function resolveSpacePermissionBrokerMode(
  runMode: PermissionMode,
  autoGuardrailInstalled: boolean,
): Exclude<PermissionMode, 'auto'> | null {
  if (runMode !== 'auto') return runMode;
  if (autoGuardrailInstalled) return null;

  // Auto without an installed SDK guardrail fails over to ordinary Edits.
  return 'accept-edits';
}

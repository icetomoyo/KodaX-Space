import type { PermissionMode } from '@kodax-space/space-ipc-schema';

/**
 * The embedded KodaX path must have exactly one permission decision owner.
 *
 * When Auto's SDK guardrail was installed for the current run, it has already
 * reviewed the tool call before `beforeToolExecute` runs. Sending the same call
 * through Space's legacy broker would turn its static risk assessment into a
 * second approval gate. If bootstrap did not complete, the broker remains the
 * fallback under accept-edits policy so Auto does not fail open through the
 * broker's legacy Auto compatibility shortcut.
 */
export function resolveSpacePermissionBrokerMode(
  runMode: PermissionMode,
  autoGuardrailInstalled: boolean,
): Exclude<PermissionMode, 'auto'> | null {
  if (runMode !== 'auto') return runMode;
  if (autoGuardrailInstalled) return null;

  // Auto without an installed SDK guardrail must fail over to the ordinary
  // accept-edits policy. Passing `auto` into the legacy broker would activate
  // its compatibility allow-once shortcut and silently widen permissions at
  // exactly the point where the classifier is absent.
  return 'accept-edits';
}

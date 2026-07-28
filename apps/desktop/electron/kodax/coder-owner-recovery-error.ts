export const CODER_OWNER_RECOVERY_RESTART_REQUIRED =
  'coder_owner_recovery_restart_required' as const;

export type CoderOwnerRecoveryRestartError = AggregateError & {
  readonly code: typeof CODER_OWNER_RECOVERY_RESTART_REQUIRED;
};

export function createCoderOwnerRecoveryRestartError(
  errors: readonly unknown[],
  message: string,
): CoderOwnerRecoveryRestartError {
  return Object.assign(new AggregateError(errors, message), {
    code: CODER_OWNER_RECOVERY_RESTART_REQUIRED,
  });
}

export function isCoderOwnerRecoveryRestartRequired(
  error: unknown,
): error is CoderOwnerRecoveryRestartError {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { readonly code?: unknown }).code === CODER_OWNER_RECOVERY_RESTART_REQUIRED
  );
}

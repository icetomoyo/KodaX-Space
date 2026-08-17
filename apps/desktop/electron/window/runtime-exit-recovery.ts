import type { RuntimeExitSettlement } from '../kodax/runtime-host-adapter.js';

export type RuntimeExitRecoveryStartupDecision =
  | { readonly action: 'continue'; readonly settlement?: RuntimeExitSettlement }
  | {
      readonly action: 'exit';
      readonly settlement: Exclude<RuntimeExitSettlement, { readonly status: 'blocked' }>;
    }
  | {
      readonly action: 'block';
      readonly settlement: Extract<RuntimeExitSettlement, { readonly status: 'blocked' }>;
    };

export async function resolveRuntimeExitRecoveryStartup(input: {
  readonly requested: boolean;
  readonly scanPending?: boolean;
  readonly settle: () => Promise<RuntimeExitSettlement>;
}): Promise<RuntimeExitRecoveryStartupDecision> {
  if (!(input.scanPending ?? input.requested)) return { action: 'continue' };
  const settlement = await input.settle();
  if (settlement.status !== 'blocked') {
    return input.requested ? { action: 'exit', settlement } : { action: 'continue', settlement };
  }
  if (settlement.nextAction === 'keep-open') {
    return { action: 'continue', settlement };
  }
  return { action: 'block', settlement };
}

export async function runRuntimeStartupBoundary(input: {
  readonly recoveryRequested: boolean;
  readonly scanPendingExit: boolean;
  readonly settle: () => Promise<RuntimeExitSettlement>;
  readonly reconcileOwnerPolicy: () => Promise<boolean>;
  readonly prepareStartup: () => Promise<void>;
  readonly initializeRuntime: (ownerPolicyReady: boolean) => void;
}): Promise<RuntimeExitRecoveryStartupDecision> {
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: input.recoveryRequested,
    scanPending: input.scanPendingExit,
    settle: input.settle,
  });
  if (decision.action !== 'continue') return decision;
  const ownerPolicyReady = await input.reconcileOwnerPolicy();
  await input.prepareStartup();
  input.initializeRuntime(ownerPolicyReady);
  return decision;
}

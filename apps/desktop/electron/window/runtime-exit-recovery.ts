import type { RuntimeExitSettlement } from '../kodax/runtime-host-adapter.js';
import { isWindowsAclRecoveryText } from '../kodax/sandbox-controller.js';

type BlockedRuntimeExitSettlement = Extract<RuntimeExitSettlement, { readonly status: 'blocked' }>;

export interface RuntimeExitRecoveryBlockedNotice {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
}

export interface RuntimeExitFailureDialogPresentation {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
}

export function runtimeExitFailureRequiresRestart(
  errorMessage: string,
  structuredRestartRequired: boolean,
): boolean {
  return structuredRestartRequired || isWindowsAclRecoveryText(errorMessage);
}

export function runtimeExitFailureDialog(
  errorMessage: string,
  restartRequired: boolean,
  locale: 'zh-CN' | 'en',
): RuntimeExitFailureDialogPresentation {
  const zh = locale === 'zh-CN';
  const aclRecovery = isWindowsAclRecoveryText(errorMessage);
  const recoveryRestartRequired = runtimeExitFailureRequiresRestart(errorMessage, restartRequired);
  const firstAction = recoveryRestartRequired
    ? zh
      ? '重启 Space 尝试恢复'
      : 'Restart Space to try recovery'
    : zh
      ? '保持 Space 开启'
      : 'Keep Space open';
  if (aclRecovery) {
    return {
      title: zh ? 'Windows 沙箱恢复待完成' : 'Windows sandbox recovery is pending',
      message: zh
        ? 'Space 无法确认命令沙箱 ACL 已恢复'
        : 'Space could not confirm that command-sandbox ACLs were restored',
      detail: zh
        ? '本次退出没有通过安全确认。Space 会先重启并尝试恢复；若仍提示同一 Windows 启动周期，请退出 Space、重启 Windows 后再打开。请勿手动删除 ACL marker。“强行关闭 Space”只会关闭当前应用，不能确认 ACL 已恢复。'
        : 'This exit did not pass safety verification. Space will restart and try recovery first. If the same-Windows-boot warning remains, quit Space, restart Windows, and reopen it. Do not delete ACL markers manually. “Force close Space” only closes this app; it does not confirm ACL recovery.',
      buttons: [firstAction, zh ? '强行关闭 Space' : 'Force close Space'],
    };
  }
  return {
    title: zh ? '暂时无法安全退出' : 'Space cannot quit safely yet',
    message: zh
      ? 'Runtime 退出准备没有安全完成'
      : 'Runtime complete-exit preparation did not finish safely',
    detail: restartRequired
      ? zh
        ? 'Space 需要重启并进入 Runtime 恢复流程；恢复完成前不会启动新的 Coder Runtime。强行关闭只停止当前 Space 所属任务。'
        : 'Space must restart into Runtime recovery and will not start a new Coder Runtime before recovery completes. Force close only stops work owned by this Space.'
      : zh
        ? '保持 Space 开启可保留当前状态；强行关闭会停止当前 Space 所属任务并完全退出。'
        : 'Keep Space open to preserve the current state. Force close stops work owned by this Space and exits completely.',
    buttons: [firstAction, zh ? '强行关闭 Space' : 'Force close Space'],
  };
}

export interface RuntimeExitRecoveryDiagnosticsAction {
  readonly diagnosticsDirectory: () => string;
  readonly ensureDirectory: (directory: string) => void;
  readonly openDirectory: (directory: string) => Promise<string>;
  readonly onOpenError: (error: string) => void;
}

export async function handleRuntimeExitRecoveryDialogResponse(
  response: number,
  action: RuntimeExitRecoveryDiagnosticsAction,
): Promise<'closed' | 'opened' | 'failed'> {
  if (response !== 0) return 'closed';
  const directory = action.diagnosticsDirectory();
  try {
    action.ensureDirectory(directory);
    const openError = await action.openDirectory(directory);
    if (!openError) return 'opened';
    action.onOpenError(openError);
    return 'failed';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    action.onOpenError(message.slice(0, 512));
    return 'failed';
  }
}

export function runtimeExitRecoveryBlockedNotice(
  settlement: BlockedRuntimeExitSettlement,
  locale: 'zh-CN' | 'en',
): RuntimeExitRecoveryBlockedNotice {
  const zh = locale === 'zh-CN';
  if (isWindowsAclRecoveryText(settlement.message)) {
    const action = zh
      ? runtimeExitRecoveryActionZh(settlement.nextAction)
      : runtimeExitRecoveryActionEn(settlement.nextAction);
    return {
      title: zh ? 'Runtime 退出恢复被阻止' : 'Runtime exit recovery blocked',
      message: zh
        ? 'Space 未启动新的 Coder Runtime'
        : 'Space did not start a competing Coder Runtime',
      detail: zh
        ? `Windows 命令沙箱的 ACL 所有者状态暂时无法安全确认。${action} 请勿手动删除 ACL marker。`
        : `The Windows command sandbox ACL owner state could not be verified safely. ${action} Do not delete ACL markers manually.`,
    };
  }
  const action = zh
    ? runtimeExitRecoveryActionZh(settlement.nextAction)
    : runtimeExitRecoveryActionEn(settlement.nextAction);
  return {
    title: zh ? 'Runtime 退出恢复被阻止' : 'Runtime exit recovery blocked',
    message: zh
      ? 'Space 未启动新的 Coder Runtime'
      : 'Space did not start a competing Coder Runtime',
    detail: zh
      ? `${action} 错误代码：${settlement.reason}。`
      : `${action} Error code: ${settlement.reason}.`,
  };
}

function runtimeExitRecoveryActionZh(
  nextAction: BlockedRuntimeExitSettlement['nextAction'],
): string {
  if (nextAction === 'restart-system') {
    return '请重启 Windows 后重新打开 Space；若问题仍存在，请在此阻断窗口选择“打开诊断目录”并联系支持。';
  }
  if (nextAction === 'relaunch-space') {
    return '请完全退出并重新打开 Space；若问题仍存在，请在此阻断窗口选择“打开诊断目录”并联系支持。';
  }
  if (nextAction === 'retry-automatically') {
    return 'Space 会继续自动验证和恢复；恢复完成前不会启动竞争的 Coder Runtime。';
  }
  return '请勿反复重启或手动删除恢复文件；请在此阻断窗口选择“打开诊断目录”并联系支持。';
}

function runtimeExitRecoveryActionEn(
  nextAction: BlockedRuntimeExitSettlement['nextAction'],
): string {
  if (nextAction === 'restart-system') {
    return 'Restart Windows and reopen Space. If the problem returns, choose “Open diagnostics folder” in this blocking window and contact support.';
  }
  if (nextAction === 'relaunch-space') {
    return 'Fully exit and reopen Space. If the problem returns, choose “Open diagnostics folder” in this blocking window and contact support.';
  }
  if (nextAction === 'retry-automatically') {
    return 'Space will keep verifying and recovering automatically without starting a competing Coder Runtime.';
  }
  return 'Do not repeatedly restart or delete recovery files. Choose “Open diagnostics folder” in this blocking window and contact support.';
}

export type RuntimeExitRecoveryStartupDecision =
  | { readonly action: 'continue'; readonly settlement?: RuntimeExitSettlement }
  | { readonly action: 'cancelled'; readonly settlement?: RuntimeExitSettlement }
  | {
      readonly action: 'exit';
      readonly settlement: Exclude<RuntimeExitSettlement, { readonly status: 'blocked' }>;
    }
  | {
      readonly action: 'block';
      readonly settlement: Extract<RuntimeExitSettlement, { readonly status: 'blocked' }>;
    };

interface RuntimeExitRecoveryStartupInput {
  readonly requested: boolean;
  readonly scanPending?: boolean;
  readonly settle: () => Promise<RuntimeExitSettlement>;
  readonly waitBeforeAutomaticRetry?: (
    attempt: number,
    shutdownSignal?: AbortSignal,
  ) => Promise<void>;
  readonly continueAutomaticRetry?: () => boolean;
  readonly shutdownSignal?: AbortSignal;
}

function recoveryStartupCancelled(input: RuntimeExitRecoveryStartupInput): boolean {
  return (
    input.shutdownSignal?.aborted === true || (input.continueAutomaticRetry?.() ?? true) === false
  );
}

function shutdownSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function waitForRetryDelay(delayMs: number, shutdownSignal?: AbortSignal): Promise<boolean> {
  if (shutdownSignal?.aborted === true) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finish(true), delayMs);
    const finish = (completed: boolean): void => {
      clearTimeout(timer);
      shutdownSignal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = (): void => finish(false);
    shutdownSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitBeforeRecoveryRetry(
  input: RuntimeExitRecoveryStartupInput,
  attempt: number,
): Promise<boolean> {
  if (input.waitBeforeAutomaticRetry === undefined) {
    const delayMs = Math.min(5_000, 250 * 2 ** Math.min(attempt - 1, 5));
    return waitForRetryDelay(delayMs, input.shutdownSignal);
  }
  if (input.shutdownSignal === undefined) {
    await input.waitBeforeAutomaticRetry(attempt);
    return true;
  }
  if (input.shutdownSignal.aborted) return false;
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = (): void => finish(false);
    const finish = (completed: boolean): void => {
      input.shutdownSignal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    input.shutdownSignal?.addEventListener('abort', onAbort, { once: true });
    void input.waitBeforeAutomaticRetry?.(attempt, input.shutdownSignal).then(
      () => finish(true),
      (error: unknown) => {
        input.shutdownSignal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function resolveRuntimeExitRecoveryStartup(
  input: RuntimeExitRecoveryStartupInput,
): Promise<RuntimeExitRecoveryStartupDecision> {
  if (recoveryStartupCancelled(input)) return { action: 'cancelled' };
  if (!(input.scanPending ?? input.requested)) return { action: 'continue' };
  let automaticRetryAttempt = 0;
  let settlement = await input.settle();
  if (recoveryStartupCancelled(input)) return { action: 'cancelled' };
  while (
    settlement.status === 'blocked' &&
    settlement.nextAction === 'retry-automatically' &&
    !recoveryStartupCancelled(input)
  ) {
    automaticRetryAttempt += 1;
    const completedWait = await waitBeforeRecoveryRetry(input, automaticRetryAttempt);
    if (!completedWait || recoveryStartupCancelled(input)) return { action: 'cancelled' };
    settlement = await input.settle();
    if (recoveryStartupCancelled(input)) return { action: 'cancelled' };
  }
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
  readonly waitBeforeAutomaticRetry?: (
    attempt: number,
    shutdownSignal?: AbortSignal,
  ) => Promise<void>;
  readonly continueAutomaticRetry?: () => boolean;
  readonly shutdownSignal?: AbortSignal;
  readonly reconcileOwnerPolicy: () => Promise<boolean>;
  readonly prepareStartup: () => Promise<void>;
  readonly initializeRuntime: (ownerPolicyReady: boolean) => void;
}): Promise<RuntimeExitRecoveryStartupDecision> {
  const decision = await resolveRuntimeExitRecoveryStartup({
    requested: input.recoveryRequested,
    scanPending: input.scanPendingExit,
    settle: input.settle,
    ...(input.waitBeforeAutomaticRetry !== undefined
      ? { waitBeforeAutomaticRetry: input.waitBeforeAutomaticRetry }
      : {}),
    ...(input.continueAutomaticRetry !== undefined
      ? { continueAutomaticRetry: input.continueAutomaticRetry }
      : {}),
    ...(input.shutdownSignal !== undefined ? { shutdownSignal: input.shutdownSignal } : {}),
  });
  if (decision.action !== 'continue') return decision;
  const ownerPolicyReady = await input.reconcileOwnerPolicy();
  if (shutdownSignalAborted(input.shutdownSignal)) return { action: 'cancelled' };
  await input.prepareStartup();
  if (shutdownSignalAborted(input.shutdownSignal)) return { action: 'cancelled' };
  input.initializeRuntime(ownerPolicyReady);
  return decision;
}

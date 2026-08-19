import type { RuntimeExitSettlement } from '../kodax/runtime-host-adapter.js';
import { isWindowsAclRecoveryText } from '../kodax/sandbox-controller.js';

type BlockedRuntimeExitSettlement = Extract<RuntimeExitSettlement, { readonly status: 'blocked' }>;

export interface RuntimeExitRecoveryBlockedNotice {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
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
  return 'Do not repeatedly restart or delete recovery files. Choose “Open diagnostics folder” in this blocking window and contact support.';
}

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

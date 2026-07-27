// F121 frozen Coder entrypoint disposition for the v0.1.32 release surface.
//
// Keep this list explicit. The companion test compares it with the registered
// Coder-related IPC namespaces so a new action cannot inherit an owner by accident.

import type { InvokeChannelName } from '@kodax-space/space-ipc-schema';

export type CoderActionReleasedState = 'ga' | 'capability-gated' | 'unavailable';
export type CoderActionTargetOwner =
  | 'coder-daemon'
  | 'space-host-provider'
  | 'space-ui-only'
  | 'reviewed-out';
export type CoderActionUnavailableBehavior =
  | 'disable-with-reason'
  | 'observe-only'
  | 'not-applicable';

export interface CoderActionDisposition {
  readonly actionId: string;
  readonly entrypoint: InvokeChannelName;
  readonly releasedState: CoderActionReleasedState;
  readonly targetOwner: CoderActionTargetOwner;
  readonly requiredCapability?: string;
  readonly unavailableBehavior: CoderActionUnavailableBehavior;
  readonly regressionFixture: string;
}

const CODER_NAMESPACE =
  /^(runtime|session|askUser|permission|slash|skill|agent|mcp|mcpb|kodax|provider|settings|workflow|memory|artifact|diagnostics|handoff|notification)\./;

export function isCoderEntrypointNamespace(name: string): name is InvokeChannelName {
  return CODER_NAMESPACE.test(name);
}

export const FROZEN_V0131_CODER_ENTRYPOINTS = [
  'agent.actor.snapshot',
  'agent.discover',
  'agent.external.dispatchable.list',
  'agent.external.preflight',
  'agent.external.reference.upsert',
  'agent.external.registration.list',
  'agent.external.registration.remove',
  'agent.external.status',
  'agent.external.task.cancel',
  'agent.external.task.events',
  'agent.external.task.list',
  'agent.external.task.reconcile',
  'agent.external.task.sendInput',
  'agent.external.task.start',
  'artifact.create',
  'artifact.delete',
  'artifact.export',
  'artifact.list',
  'artifact.openWindow',
  'artifact.previewFile',
  'artifact.read',
  'artifact.readBinary',
  'askUser.reply',
  'diagnostics.export',
  'diagnostics.report',
  'handoff.accept',
  'handoff.dismiss',
  'handoff.list',
  'kodax.getDefaults',
  'kodax.queueGet',
  'mcp.discover',
  'mcp.logs',
  'mcp.reload',
  'mcp.servers',
  'mcp.start',
  'mcp.stop',
  'mcp.tools',
  'mcpb.install',
  'mcpb.list',
  'mcpb.uninstall',
  'memory.approve',
  'memory.curate',
  'memory.list',
  'memory.pack',
  'memory.proposal',
  'memory.readRef',
  'memory.reject',
  'notification.show',
  'permission.answer',
  'permission.list',
  'permission.revoke',
  'provider.addCustom',
  'provider.list',
  'provider.modelContextWindow',
  'provider.removeCustom',
  'provider.removeKey',
  'provider.setDefault',
  'provider.setKey',
  'provider.test',
  'provider.updateCustom',
  'runtime.profileSnapshot',
  'session.agentsMd',
  'session.agentsMd.save',
  'session.cancel',
  'session.create',
  'session.delete',
  'session.fork',
  'session.history',
  'session.list',
  'session.listRunning',
  'session.liveSnapshot',
  'session.localNotice.append',
  'session.localNotice.replace',
  'session.promoteEphemeral',
  'session.rewind',
  'session.send',
  'session.setAgentMode',
  'session.setAutoModeEngine',
  'session.setPermissionMode',
  'session.setProvider',
  'session.setReasoningMode',
  'session.setTitle',
  'settings.get',
  'settings.kodaxConfig.get',
  'settings.kodaxConfig.setCompaction',
  'settings.setDefaultWorkspace',
  'settings.setLanguageMode',
  'settings.setRuntimeDefaults',
  'settings.setTerminalShell',
  'settings.setWindowCloseBehavior',
  'skill.discover',
  'skill.install',
  'skill.invoke',
  'slash.discover',
  'slash.exec',
  'workflow.delete',
  'workflow.get',
  'workflow.library',
  'workflow.list',
  'workflow.pause',
  'workflow.policy.get',
  'workflow.policy.set',
  'workflow.preflight',
  'workflow.prune',
  'workflow.rename',
  'workflow.rerun',
  'workflow.result',
  'workflow.resume',
  'workflow.save',
  'workflow.saved.delete',
  'workflow.saved.rename',
  'workflow.start',
  'workflow.stop',
] as const satisfies readonly InvokeChannelName[];

export const CODER_DAEMON_ROUTED_ENTRYPOINTS = [
  'agent.actor.snapshot',
  'agent.external.dispatchable.list',
  'agent.external.preflight',
  'agent.external.task.cancel',
  'agent.external.task.events',
  'agent.external.task.list',
  'agent.external.task.reconcile',
  'agent.external.task.sendInput',
  'agent.external.task.start',
  'askUser.reply',
  'kodax.queueGet',
  'mcp.reload',
  'mcp.tools',
  'permission.answer',
  'permission.list',
  'permission.revoke',
  'runtime.profileSnapshot',
  'session.cancel',
  'session.create',
  'session.delete',
  'session.fork',
  'session.history',
  'session.liveSnapshot',
  'session.rewind',
  'session.send',
  'session.setAgentMode',
  'session.setAutoModeEngine',
  'session.setPermissionMode',
  'session.setProvider',
  'session.setReasoningMode',
  'skill.discover',
  'slash.discover',
  'workflow.get',
  'workflow.list',
  'workflow.pause',
  'workflow.resume',
  'workflow.stop',
] as const satisfies readonly InvokeChannelName[];

const CODER_DAEMON_ROUTED = new Set<InvokeChannelName>(CODER_DAEMON_ROUTED_ENTRYPOINTS);

function targetOwnerFor(entrypoint: InvokeChannelName): CoderActionTargetOwner {
  if (CODER_DAEMON_ROUTED.has(entrypoint)) return 'coder-daemon';
  if (
    entrypoint.startsWith('artifact.') ||
    entrypoint.startsWith('diagnostics.') ||
    entrypoint.startsWith('handoff.') ||
    entrypoint.startsWith('mcpb.') ||
    entrypoint.startsWith('notification.') ||
    entrypoint.startsWith('session.agentsMd') ||
    (entrypoint.startsWith('provider.') && entrypoint !== 'provider.setDefault')
  ) {
    return 'space-host-provider';
  }
  if (
    entrypoint.startsWith('session.localNotice.') ||
    entrypoint === 'settings.get' ||
    entrypoint === 'settings.setDefaultWorkspace' ||
    entrypoint === 'settings.setLanguageMode' ||
    entrypoint === 'settings.setTerminalShell' ||
    entrypoint === 'settings.setWindowCloseBehavior'
  ) {
    return 'space-ui-only';
  }
  return 'space-host-provider';
}

function capabilityFor(entrypoint: InvokeChannelName): string | undefined {
  const targetOwner = targetOwnerFor(entrypoint);
  if (targetOwner !== 'coder-daemon') return undefined;
  if (entrypoint === 'runtime.profileSnapshot' || entrypoint === 'session.liveSnapshot') {
    return 'runtime.live.observe';
  }
  if (entrypoint.startsWith('askUser.')) return 'runtime.userInput';
  if (entrypoint.startsWith('permission.')) return 'runtime.permissions';
  if (entrypoint === 'kodax.queueGet') return 'runtime.inputQueue';
  if (entrypoint === 'provider.setDefault') return 'runtime.config.cas';
  if (
    entrypoint === 'settings.setRuntimeDefaults' ||
    entrypoint === 'settings.kodaxConfig.setCompaction'
  ) {
    return 'runtime.config.cas';
  }
  if (entrypoint === 'settings.kodaxConfig.get') return 'runtime.config';
  if (entrypoint.startsWith('workflow.')) return 'runtime.workflows';
  if (entrypoint.startsWith('mcp.')) return 'runtime.mcp';
  if (entrypoint.startsWith('skill.')) return 'runtime.catalog';
  if (entrypoint.startsWith('slash.')) return 'runtime.commands';
  if (entrypoint.startsWith('agent.external.')) return 'runtime.externalAgents';
  if (entrypoint.startsWith('agent.')) return 'runtime.agents';
  if (entrypoint.startsWith('memory.')) return 'runtime.memory';
  if (entrypoint === 'kodax.getDefaults') return 'runtime.config';
  if (entrypoint.startsWith('session.')) return 'runtime.sessions';
  return undefined;
}

function releasedStateFor(entrypoint: InvokeChannelName): CoderActionReleasedState {
  return entrypoint.startsWith('memory.') ? 'capability-gated' : 'ga';
}

function dispositionFor(entrypoint: InvokeChannelName): CoderActionDisposition {
  const targetOwner = targetOwnerFor(entrypoint);
  const requiredCapability = capabilityFor(entrypoint);
  const releasedState = releasedStateFor(entrypoint);
  return {
    actionId: `f121:${entrypoint}`,
    entrypoint,
    releasedState,
    targetOwner,
    ...(requiredCapability !== undefined ? { requiredCapability } : {}),
    unavailableBehavior:
      targetOwner === 'coder-daemon' || releasedState === 'capability-gated'
        ? 'disable-with-reason'
        : 'not-applicable',
    regressionFixture: `v0.1.31:${entrypoint}`,
  };
}

export const CODER_ACTION_MANIFEST: readonly CoderActionDisposition[] = Object.freeze(
  FROZEN_V0131_CODER_ENTRYPOINTS.map(dispositionFor),
);

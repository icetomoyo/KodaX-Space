import type { SpaceActionIdT } from '@kodax-space/space-ipc-schema';

export type ControlInventoryArea = 'settings' | 'shell' | 'command-palette' | 'local-slash';
export type ControlClassification =
  | 'llm-visible'
  | 'deferred'
  | 'user-only'
  | 'deterministic-only'
  | 'not-semantic';

export interface ControlInventoryEntry {
  readonly controlId: string;
  readonly area: ControlInventoryArea;
  readonly classification: ControlClassification;
  readonly actionId?: SpaceActionIdT;
  readonly reasonCode?:
    | 'confirmation-required'
    | 'credential-boundary'
    | 'destructive'
    | 'external-side-effect'
    | 'native-picker'
    | 'private-content'
    | 'read-only-existing'
    | 'ui-mechanics'
    | 'unbounded-argument'
    | 'unsafe-readback';
}

const settings: readonly ControlInventoryEntry[] = [
  ...(['preferences', 'providers', 'runtime', 'diagnostics', 'license'] as const).map((tab) => ({
    controlId: `settings.nav.${tab}`,
    area: 'settings' as const,
    classification: 'llm-visible' as const,
    actionId: 'ui.settings.open' as const,
  })),
  {
    controlId: 'settings.language',
    area: 'settings',
    classification: 'llm-visible',
    actionId: 'ui.language.set',
  },
  {
    controlId: 'settings.defaultWorkspace',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'native-picker',
  },
  {
    controlId: 'settings.smartPopout',
    area: 'settings',
    classification: 'deferred',
    reasonCode: 'unsafe-readback',
  },
  {
    controlId: 'settings.completionNotifications',
    area: 'settings',
    classification: 'deferred',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.workflowPolicy',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'settings.externalAgents.manage',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.externalAgents.preflight',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.externalAgents.conformance',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.compaction',
    area: 'settings',
    classification: 'deferred',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'settings.mcp.reload',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.skills.install',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'native-picker',
  },
  {
    controlId: 'settings.providers.default',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'credential-boundary',
  },
  {
    controlId: 'settings.providers.manage',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'credential-boundary',
  },
  {
    controlId: 'settings.providers.test',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'settings.license.import',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'credential-boundary',
  },
  {
    controlId: 'settings.license.exportRequest',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'native-picker',
  },
  {
    controlId: 'settings.license.refresh',
    area: 'settings',
    classification: 'deterministic-only',
    reasonCode: 'read-only-existing',
  },
  {
    controlId: 'settings.diagnostics.export',
    area: 'settings',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
];

const shell: readonly ControlInventoryEntry[] = [
  {
    controlId: 'shell.surfaceTabs',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.surface.set',
  },
  {
    controlId: 'shell.file.newSession',
    area: 'shell',
    classification: 'deferred',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'shell.file.openFolder',
    area: 'shell',
    classification: 'user-only',
    reasonCode: 'native-picker',
  },
  {
    controlId: 'shell.file.settings',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.settings.open',
  },
  {
    controlId: 'shell.edit.undoRedo',
    area: 'shell',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
  {
    controlId: 'shell.edit.clipboard',
    area: 'shell',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
  {
    controlId: 'shell.edit.selectAll',
    area: 'shell',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
  {
    controlId: 'shell.view.commandPalette',
    area: 'shell',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
  {
    controlId: 'shell.view.leftSidebar',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.leftSidebar.setOpen',
  },
  {
    controlId: 'shell.view.taskDock',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.taskDock.setOpen',
  },
  {
    controlId: 'shell.view.taskDockWidth',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.taskDock.widthMode.set',
  },
  {
    controlId: 'shell.view.focusMode',
    area: 'shell',
    classification: 'deferred',
    reasonCode: 'unsafe-readback',
  },
  {
    controlId: 'shell.view.theme',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.theme.set',
  },
  {
    controlId: 'shell.view.visualQuality',
    area: 'shell',
    classification: 'deferred',
    reasonCode: 'unsafe-readback',
  },
  {
    controlId: 'shell.view.language',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'ui.language.set',
  },
  {
    controlId: 'shell.reasoningMode.default',
    area: 'shell',
    classification: 'llm-visible',
    actionId: 'settings.reasoningMode.setDefault',
  },
  {
    controlId: 'shell.view.diagnosticsOverlay',
    area: 'shell',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
  {
    controlId: 'shell.help.shortcuts',
    area: 'shell',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
  {
    controlId: 'shell.window.controls',
    area: 'shell',
    classification: 'user-only',
    reasonCode: 'destructive',
  },
];

const commandPalette: readonly ControlInventoryEntry[] = [
  {
    controlId: 'commandPalette.newSession',
    area: 'command-palette',
    classification: 'deferred',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'commandPalette.toggleTheme',
    area: 'command-palette',
    classification: 'llm-visible',
    actionId: 'ui.theme.set',
  },
  {
    controlId: 'commandPalette.clearConversation',
    area: 'command-palette',
    classification: 'user-only',
    reasonCode: 'destructive',
  },
  {
    controlId: 'commandPalette.sessionNavigation',
    area: 'command-palette',
    classification: 'deferred',
    reasonCode: 'unbounded-argument',
  },
  {
    controlId: 'commandPalette.fileInsertion',
    area: 'command-palette',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
  {
    controlId: 'commandPalette.slashInsertion',
    area: 'command-palette',
    classification: 'not-semantic',
    reasonCode: 'ui-mechanics',
  },
];

const slashReadOnly = [
  'show-cost',
  'show-tree',
  'show-history',
  'show-repointel-status',
  'show-repointel-trace',
  'show-repointel',
  'show-status',
  'show-doctor',
  'show-extensions',
  'show-mcp',
  'list-sessions',
  'list-skills',
] as const;

const localSlash: readonly ControlInventoryEntry[] = [
  ...slashReadOnly.map((action) => ({
    controlId: `slash.${action}`,
    area: 'local-slash' as const,
    classification: 'deterministic-only' as const,
    reasonCode: 'read-only-existing' as const,
  })),
  {
    controlId: 'slash.new-session',
    area: 'local-slash',
    classification: 'deferred',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'slash.copy-last',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
  {
    controlId: 'slash.show-memory',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
  {
    controlId: 'slash.insert-review-template',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'private-content',
  },
  {
    controlId: 'slash.exit-app',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'destructive',
  },
  {
    controlId: 'slash.reload-context',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'external-side-effect',
  },
  {
    controlId: 'slash.load-session',
    area: 'local-slash',
    classification: 'deferred',
    reasonCode: 'unbounded-argument',
  },
  {
    controlId: 'slash.delete-session',
    area: 'local-slash',
    classification: 'user-only',
    reasonCode: 'destructive',
  },
  {
    controlId: 'slash.fork-session',
    area: 'local-slash',
    classification: 'deferred',
    reasonCode: 'confirmation-required',
  },
  {
    controlId: 'slash.rewind-session',
    area: 'local-slash',
    classification: 'deferred',
    reasonCode: 'destructive',
  },
];

export const SPACE_CONTROL_INVENTORY: readonly ControlInventoryEntry[] = [
  ...settings,
  ...shell,
  ...commandPalette,
  ...localSlash,
];

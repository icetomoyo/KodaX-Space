import type {
  SpaceActionArgsT,
  SpaceActionIdT,
  SpaceActionValueT,
  Surface,
} from '@kodax-space/space-ipc-schema';
import { reasoningModeSchema } from '@kodax-space/space-ipc-schema';

export interface SpaceActionDescriptor {
  readonly id: SpaceActionIdT;
  readonly title: string;
  readonly description: string;
  readonly effect: 'ui-ephemeral' | 'preference-write';
  readonly surfaces: readonly Surface[];
  readonly planModeAllowed: boolean;
  readonly valueType: 'boolean' | 'enum' | 'string';
  readonly allowedValues?: readonly string[];
  readonly aliases: readonly string[];
}

export const SPACE_ACTION_DESCRIPTORS: readonly SpaceActionDescriptor[] = [
  {
    id: 'ui.theme.set',
    title: 'Set theme',
    description: 'Set the Space theme to dark, light, or system.',
    effect: 'preference-write',
    surfaces: ['code', 'partner'],
    planModeAllowed: true,
    valueType: 'enum',
    allowedValues: ['dark', 'light', 'system'],
    aliases: ['theme', 'appearance', 'dark', 'light'],
  },
  {
    id: 'ui.language.set',
    title: 'Set display language',
    description: 'Set the Space UI language or follow the operating system.',
    effect: 'preference-write',
    surfaces: ['code', 'partner'],
    planModeAllowed: true,
    valueType: 'enum',
    allowedValues: ['system', 'zh-CN', 'en-US'],
    aliases: ['language', 'locale', '中文', 'english'],
  },
  {
    id: 'ui.surface.set',
    title: 'Set product surface',
    description: 'Switch between Coder and Partner without rebinding the originating run.',
    effect: 'ui-ephemeral',
    surfaces: ['code', 'partner'],
    planModeAllowed: true,
    valueType: 'enum',
    allowedValues: ['code', 'partner'],
    aliases: ['surface', 'coder', 'partner'],
  },
  {
    id: 'ui.settings.open',
    title: 'Open Settings section',
    description: 'Open one registered Settings tab.',
    effect: 'ui-ephemeral',
    surfaces: ['code', 'partner'],
    planModeAllowed: true,
    valueType: 'enum',
    allowedValues: ['preferences', 'providers', 'runtime', 'diagnostics', 'license'],
    aliases: ['settings', 'provider settings', 'runtime settings', 'diagnostics', 'license'],
  },
  {
    id: 'ui.leftSidebar.setOpen',
    title: 'Set left sidebar open state',
    description: 'Open or close the left sidebar explicitly.',
    effect: 'ui-ephemeral',
    surfaces: ['code', 'partner'],
    planModeAllowed: true,
    valueType: 'boolean',
    aliases: ['left sidebar', 'navigation sidebar'],
  },
  {
    id: 'ui.taskDock.setOpen',
    title: 'Set Task Dock open state',
    description: 'Open or close the Coder Task Dock explicitly.',
    effect: 'ui-ephemeral',
    surfaces: ['code'],
    planModeAllowed: true,
    valueType: 'boolean',
    aliases: ['task dock', 'right sidebar'],
  },
  {
    id: 'ui.taskDock.widthMode.set',
    title: 'Set Task Dock width preset',
    description: 'Set the Task Dock to default, half, or maximum width.',
    effect: 'ui-ephemeral',
    surfaces: ['code'],
    planModeAllowed: true,
    valueType: 'enum',
    allowedValues: ['default', 'half', 'max'],
    aliases: ['task dock width', 'half width', 'maximum task dock'],
  },
  {
    id: 'settings.reasoningMode.setDefault',
    title: 'Set default reasoning mode',
    description: 'Set the SDK reasoning effort used by new sessions.',
    effect: 'preference-write',
    surfaces: ['code'],
    planModeAllowed: false,
    valueType: 'string',
    aliases: ['reasoning', 'thinking', 'deep reasoning', 'effort default'],
  },
] as const;

const descriptorById = new Map(
  SPACE_ACTION_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

export function getSpaceActionDescriptor(id: SpaceActionIdT): SpaceActionDescriptor {
  return descriptorById.get(id)!;
}

export function validateSpaceActionArgs(
  descriptor: SpaceActionDescriptor,
  args: SpaceActionArgsT,
): args is { value: SpaceActionValueT } {
  if (descriptor.valueType === 'boolean') return typeof args.value === 'boolean';
  if (descriptor.id === 'settings.reasoningMode.setDefault') {
    return reasoningModeSchema.safeParse(args.value).success;
  }
  return typeof args.value === 'string' && Boolean(descriptor.allowedValues?.includes(args.value));
}

export function listSpaceActionDescriptors(
  query: string | undefined,
  surface: Surface,
): SpaceActionDescriptor[] {
  const normalized = query?.trim().toLowerCase() ?? '';
  return SPACE_ACTION_DESCRIPTORS.filter((descriptor) => {
    if (!descriptor.surfaces.includes(surface)) return false;
    if (!normalized) return true;
    const haystack = [
      descriptor.id,
      descriptor.title,
      descriptor.description,
      ...descriptor.aliases,
    ]
      .join(' ')
      .toLowerCase();
    return normalized.split(/\s+/).every((term) => haystack.includes(term));
  });
}

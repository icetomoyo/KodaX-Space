import { useCallback, useEffect, useRef } from 'react';
import type {
  LanguageModeT,
  SpaceActionIdT,
  SpaceActionValueT,
  SpaceControlResultT,
  PushPayload,
  ReasoningMode,
  Surface,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { SettingsTab } from '../features/settings/SettingsModal.js';
import {
  setSpaceLanguage,
  setSpaceLeftSidebarOpen,
  setSpaceReasoningDefault,
  setSpaceSurface,
  setSpaceTaskDockOpen,
  setSpaceTheme,
} from './semanticActions.js';

export type TaskDockWidthPreset = 'default' | 'half' | 'max';
type TaskDockWidthState = TaskDockWidthPreset | 'custom';

interface SpaceControlBrokerProps {
  readonly settingsOpen: boolean;
  readonly settingsTab: SettingsTab;
  readonly taskDockWidthMode: TaskDockWidthState;
  readonly onOpenSettings: (tab: SettingsTab) => void;
  readonly onSetTaskDockWidthMode: (mode: TaskDockWidthPreset) => void;
}

interface ObservedActionState {
  readonly value: SpaceActionValueT;
  readonly revision: number;
}

const THEMES = new Set<'dark' | 'light' | 'system'>(['dark', 'light', 'system']);
const LANGUAGES = new Set<LanguageModeT>(['system', 'zh-CN', 'en-US']);
const SURFACES = new Set<Surface>(['code', 'partner']);
const SETTINGS_TABS = new Set<SettingsTab>([
  'preferences',
  'providers',
  'runtime',
  'diagnostics',
  'license',
]);
const WIDTH_PRESETS = new Set<TaskDockWidthPreset>(['default', 'half', 'max']);
const REASONING_MODES = new Set<ReasoningMode>([
  'off',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'quick',
  'balanced',
  'deep',
]);
const RENDERER_INSTANCE_ID = globalThis.crypto.randomUUID();

function isStringIn<T extends string>(values: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && values.has(value as T);
}

function safeStateForAction(
  actionId: SpaceActionIdT,
  props: Pick<SpaceControlBrokerProps, 'settingsOpen' | 'settingsTab' | 'taskDockWidthMode'>,
): SpaceActionValueT | undefined {
  const app = useAppStore.getState();
  switch (actionId) {
    case 'ui.theme.set':
      return app.theme;
    case 'ui.language.set':
      return undefined;
    case 'ui.surface.set':
      return useSurfaceStore.getState().currentSurface;
    case 'ui.settings.open':
      return props.settingsOpen ? props.settingsTab : 'closed';
    case 'ui.leftSidebar.setOpen':
      return app.leftSidebarOpen;
    case 'ui.taskDock.setOpen':
      return app.rightSidebarOpen;
    case 'ui.taskDock.widthMode.set':
      return props.taskDockWidthMode;
    case 'settings.reasoningMode.setDefault':
      return app.runtimeDefaults.reasoningMode ?? 'auto';
  }
}

export function SpaceControlBroker(props: SpaceControlBrokerProps): null {
  const { languageMode, setLanguageMode } = useI18n();
  const { settingsOpen, settingsTab, taskDockWidthMode, onOpenSettings, onSetTaskDockWidthMode } =
    props;
  const observedRef = useRef(new Map<SpaceActionIdT, ObservedActionState>());

  const observe = useCallback((actionId: SpaceActionIdT, value: SpaceActionValueT) => {
    const previous = observedRef.current.get(actionId);
    const revision =
      previous === undefined
        ? 0
        : previous.value === value
          ? previous.revision
          : previous.revision + 1;
    observedRef.current.set(actionId, { value, revision });
    return revision;
  }, []);

  const currentState = useCallback(
    (actionId: SpaceActionIdT): { value?: SpaceActionValueT; revision: number } => {
      const value =
        actionId === 'ui.language.set'
          ? languageMode
          : safeStateForAction(actionId, {
              settingsOpen,
              settingsTab,
              taskDockWidthMode,
            });
      if (value === undefined) return { revision: 0 };
      return { value, revision: observe(actionId, value) };
    },
    [languageMode, observe, settingsOpen, settingsTab, taskDockWidthMode],
  );

  const execute = useCallback(
    async (actionId: SpaceActionIdT, value: SpaceActionValueT): Promise<string | undefined> => {
      switch (actionId) {
        case 'ui.theme.set':
          if (!isStringIn(THEMES, value)) return 'invalid-arguments';
          setSpaceTheme(value);
          return undefined;
        case 'ui.language.set':
          if (!isStringIn(LANGUAGES, value)) return 'invalid-arguments';
          return (await setSpaceLanguage(value, setLanguageMode))
            ? undefined
            : 'persistence-failed';
        case 'ui.surface.set':
          if (!isStringIn(SURFACES, value)) return 'invalid-arguments';
          setSpaceSurface(value);
          return undefined;
        case 'ui.settings.open':
          if (!isStringIn(SETTINGS_TABS, value)) return 'invalid-arguments';
          onOpenSettings(value);
          return undefined;
        case 'ui.leftSidebar.setOpen':
          if (typeof value !== 'boolean') return 'invalid-arguments';
          setSpaceLeftSidebarOpen(value);
          return undefined;
        case 'ui.taskDock.setOpen':
          if (typeof value !== 'boolean') return 'invalid-arguments';
          if (useSurfaceStore.getState().currentSurface !== 'code') return 'surface-unavailable';
          setSpaceTaskDockOpen(value);
          return undefined;
        case 'ui.taskDock.widthMode.set':
          if (!isStringIn(WIDTH_PRESETS, value)) return 'invalid-arguments';
          if (useSurfaceStore.getState().currentSurface !== 'code') return 'surface-unavailable';
          onSetTaskDockWidthMode(value);
          return undefined;
        case 'settings.reasoningMode.setDefault': {
          if (!isStringIn(REASONING_MODES, value)) return 'invalid-arguments';
          return (await setSpaceReasoningDefault(value)) ? undefined : 'persistence-failed';
        }
      }
    },
    [onOpenSettings, onSetTaskDockWidthMode, setLanguageMode],
  );

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    return bridge.on('spaceControl.requested', (request: PushPayload<'spaceControl.requested'>) => {
      void (async () => {
        const before = currentState(request.actionId);
        let result: SpaceControlResultT;
        if (request.operation === 'inspect') {
          result = {
            requestId: request.requestId,
            actionId: request.actionId,
            status: before.value === undefined ? 'unknown' : 'available',
            revision: before.revision,
            rendererInstanceId: RENDERER_INSTANCE_ID,
            ...(before.value !== undefined ? { safeState: before.value } : {}),
            summaryKey:
              before.value === undefined ? 'spaceControl.unknown' : 'spaceControl.available',
            ...(before.value === undefined ? { reasonCode: 'state-unavailable' } : {}),
          };
        } else if (!request.args || request.expectedRevision === undefined) {
          result = {
            requestId: request.requestId,
            actionId: request.actionId,
            status: 'denied',
            revision: before.revision,
            rendererInstanceId: RENDERER_INSTANCE_ID,
            summaryKey: 'spaceControl.denied',
            reasonCode: 'invalid-request',
          };
        } else if (request.expectedRendererInstanceId !== RENDERER_INSTANCE_ID) {
          result = {
            requestId: request.requestId,
            actionId: request.actionId,
            status: 'denied',
            revision: before.revision,
            rendererInstanceId: RENDERER_INSTANCE_ID,
            ...(before.value !== undefined ? { safeState: before.value } : {}),
            summaryKey: 'spaceControl.denied',
            reasonCode: 'renderer-instance-changed',
          };
        } else if (before.revision !== request.expectedRevision) {
          result = {
            requestId: request.requestId,
            actionId: request.actionId,
            status: 'denied',
            revision: before.revision,
            rendererInstanceId: RENDERER_INSTANCE_ID,
            ...(before.value !== undefined ? { safeState: before.value } : {}),
            summaryKey: 'spaceControl.denied',
            reasonCode: 'stale-revision',
          };
        } else {
          const reasonCode = await execute(request.actionId, request.args.value);
          const after = reasonCode
            ? currentState(request.actionId)
            : {
                value: request.args.value,
                revision: observe(request.actionId, request.args.value),
              };
          result = {
            requestId: request.requestId,
            actionId: request.actionId,
            status: reasonCode ? 'failed' : before.value === after.value ? 'unchanged' : 'applied',
            revision: after.revision,
            rendererInstanceId: RENDERER_INSTANCE_ID,
            ...(after.value !== undefined ? { safeState: after.value } : {}),
            summaryKey: reasonCode
              ? 'spaceControl.failed'
              : before.value === after.value
                ? 'spaceControl.unchanged'
                : 'spaceControl.applied',
            ...(reasonCode ? { reasonCode } : {}),
          };
        }
        await bridge.invoke('spaceControl.resolve', result);
      })().catch(() => undefined);
    });
  }, [currentState, execute, observe]);

  return null;
}

// Settings IPC handlers — alpha.1
//
// renderer 通过这两 channel 读写 ~/.kodax/space/settings.json。
// 写后立即 ensure 目录存在，让 setDefaultWorkspace 返回后 renderer 直接拿来当
// currentProjectPath 用，不会撞 ENOENT。

import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import { settingsStore, type SpaceSettings } from '../settings/store.js';
import { validateProjectRoot } from './validate.js';
import { resolveEffectiveLocale, type SpaceSettingsT } from '@kodax-space/space-ipc-schema';
import {
  loadKodaxConfigOverview,
  updateKodaxCompactionConfig,
  updateKodaxSandboxConfig,
} from '../kodax/user-config.js';
import {
  applyKodaxIntegrationMigration,
  planKodaxIntegrationMigration,
} from '../kodax/integration-migration.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import {
  runWithCoderAdmission,
  type CoderAdmissionOptions,
} from '../kodax/coder-runtime-mode-switch.js';

function getPreferredSystemLanguages(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const electron = req('electron') as typeof import('electron');
    return electron.app.getPreferredSystemLanguages();
  } catch {
    return [];
  }
}

function toSettingsOutput(settings: {
  readonly defaultWorkspace: string;
  readonly languageMode: SpaceSettingsT['languageMode'];
  readonly terminalShell: SpaceSettingsT['terminalShell'];
  readonly windowCloseBehavior: SpaceSettingsT['windowCloseBehavior'];
  readonly coderRuntimeMode: SpaceSettingsT['coderRuntimeMode'];
  readonly runtimeDefaults?: SpaceSettingsT['runtimeDefaults'];
}): SpaceSettingsT {
  const preferredSystemLanguages = getPreferredSystemLanguages();
  return {
    defaultWorkspace: settings.defaultWorkspace,
    languageMode: settings.languageMode,
    terminalShell: settings.terminalShell,
    windowCloseBehavior: settings.windowCloseBehavior,
    coderRuntimeMode: settings.coderRuntimeMode,
    effectiveLocale: resolveEffectiveLocale(settings.languageMode, preferredSystemLanguages),
    preferredSystemLanguages,
    runtimeDefaults: settings.runtimeDefaults ?? {},
  };
}

export interface SettingsChannelsOptions extends CoderAdmissionOptions {
  readonly switchCoderRuntimeMode?: (mode: SpaceSettingsT['coderRuntimeMode']) => Promise<{
    readonly settings: SpaceSettings;
    readonly restarting: boolean;
  }>;
}

function rethrowActionableConfigConflict(error: unknown): never {
  const name =
    error instanceof Error
      ? error.name || error.constructor.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';
  if (
    name === 'CoreConfigWriteConflictError' ||
    name === 'IntegrationConfigConflictError' ||
    /config(?:uration)? write conflict/i.test(
      error instanceof Error ? error.message : String(error),
    )
  ) {
    throw new Error(
      'KodaX configuration changed in another process. Reload Runtime settings and retry; Space did not overwrite the newer file.',
    );
  }
  throw error;
}

async function reloadRuntimeConfigAfterWrite(channel: string): Promise<{
  readonly status: 'applied' | 'not-required' | 'failed';
  readonly warning?: string;
}> {
  if (!runtimeHostAdapter.isRuntimeSelected()) return { status: 'not-required' };
  try {
    await runtimeHostAdapter.reloadRuntimeConfig();
    return { status: 'applied' };
  } catch (error) {
    console.warn(
      `[${channel}] Coder daemon config reload failed:`,
      error instanceof Error ? error.message : error,
    );
    return {
      status: 'failed',
      warning:
        'The configuration file was saved, but the running Coder Runtime did not apply it. Restart Runtime after reviewing integration diagnostics.',
    };
  }
}

export function registerSettingsChannels(options: SettingsChannelsOptions = {}): void {
  registerChannel('settings.get', async () => {
    const s = await settingsStore.load();
    return toSettingsOutput(s);
  });

  registerChannel('settings.setCoderRuntimeMode', async ({ coderRuntimeMode }) => {
    const result = options.switchCoderRuntimeMode
      ? await options.switchCoderRuntimeMode(coderRuntimeMode)
      : {
          settings: await settingsStore.setCoderRuntimeMode(coderRuntimeMode),
          restarting: false,
        };
    return {
      settings: toSettingsOutput(result.settings),
      restarting: result.restarting,
    };
  });

  registerChannel('settings.setDefaultWorkspace', async ({ path }) => {
    // 与 project.recent.add 同样走 validateProjectRoot 防 path traversal
    const safePath = validateProjectRoot(path);
    const next = await settingsStore.setDefaultWorkspace(safePath);
    await settingsStore.ensureWorkspaceExists();
    return toSettingsOutput(next);
  });

  registerChannel('settings.setLanguageMode', async ({ languageMode }) => {
    const next = await settingsStore.setLanguageMode(languageMode);
    return toSettingsOutput(next);
  });

  registerChannel('settings.setTerminalShell', async ({ terminalShell }) => {
    const next = await settingsStore.setTerminalShell(terminalShell);
    return toSettingsOutput(next);
  });

  registerChannel('settings.setWindowCloseBehavior', async ({ windowCloseBehavior }) => {
    const next = await settingsStore.setWindowCloseBehavior(windowCloseBehavior);
    return toSettingsOutput(next);
  });

  registerChannel('settings.setRuntimeDefaults', async ({ runtimeDefaults }) => {
    const next = await settingsStore.setRuntimeDefaults(runtimeDefaults);
    return toSettingsOutput(next);
  });

  registerChannel('settings.kodaxConfig.get', async ({ projectRoot }) => {
    const safeProjectRoot = projectRoot ? validateProjectRoot(projectRoot) : undefined;
    return loadKodaxConfigOverview(safeProjectRoot);
  });

  registerChannel('settings.kodaxConfig.setCompaction', ({ projectRoot, compaction }) =>
    runWithCoderAdmission(options, async () => {
      const safeProjectRoot = projectRoot ? validateProjectRoot(projectRoot) : undefined;
      const result = await updateKodaxCompactionConfig(compaction, safeProjectRoot).catch(
        rethrowActionableConfigConflict,
      );
      const runtimeReload = await reloadRuntimeConfigAfterWrite(
        'settings.kodaxConfig.setCompaction',
      );
      return { ...result, runtimeReload };
    }),
  );

  registerChannel('settings.kodaxConfig.setSandbox', ({ projectRoot, sandbox }) =>
    runWithCoderAdmission(options, async () => {
      const safeProjectRoot = projectRoot ? validateProjectRoot(projectRoot) : undefined;
      const result = await updateKodaxSandboxConfig(sandbox, safeProjectRoot).catch(
        rethrowActionableConfigConflict,
      );
      const runtimeReload = await reloadRuntimeConfigAfterWrite('settings.kodaxConfig.setSandbox');
      return { ...result, runtimeReload };
    }),
  );

  registerChannel('settings.kodaxConfig.planIntegrationMigration', async () => {
    const plan = await planKodaxIntegrationMigration();
    return { ...plan, warnings: [...plan.warnings] };
  });

  registerChannel('settings.kodaxConfig.applyIntegrationMigration', () =>
    runWithCoderAdmission(options, async () => {
      const result = await applyKodaxIntegrationMigration().catch(rethrowActionableConfigConflict);
      const runtimeReload = await reloadRuntimeConfigAfterWrite(
        'settings.kodaxConfig.applyIntegrationMigration',
      );
      return {
        ...result,
        warnings: [...result.warnings],
        applied: [...result.applied],
        runtimeReload,
      };
    }),
  );
}

// Settings IPC handlers — alpha.1
//
// renderer 通过这两 channel 读写 ~/.kodax/space/settings.json。
// 写后立即 ensure 目录存在，让 setDefaultWorkspace 返回后 renderer 直接拿来当
// currentProjectPath 用，不会撞 ENOENT。

import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import { settingsStore } from '../settings/store.js';
import { validateProjectRoot } from './validate.js';
import { resolveEffectiveLocale, type SpaceSettingsT } from '@kodax-space/space-ipc-schema';
import { loadKodaxConfigOverview, updateKodaxCompactionConfig } from '../kodax/user-config.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

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
  readonly runtimeDefaults?: SpaceSettingsT['runtimeDefaults'];
}): SpaceSettingsT {
  const preferredSystemLanguages = getPreferredSystemLanguages();
  return {
    defaultWorkspace: settings.defaultWorkspace,
    languageMode: settings.languageMode,
    effectiveLocale: resolveEffectiveLocale(settings.languageMode, preferredSystemLanguages),
    preferredSystemLanguages,
    runtimeDefaults: settings.runtimeDefaults ?? {},
  };
}

export function registerSettingsChannels(): void {
  registerChannel('settings.get', async () => {
    const s = await settingsStore.load();
    return toSettingsOutput(s);
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

  registerChannel('settings.setRuntimeDefaults', async ({ runtimeDefaults }) => {
    const next = await settingsStore.setRuntimeDefaults(runtimeDefaults);
    return toSettingsOutput(next);
  });

  registerChannel('settings.kodaxConfig.get', async ({ projectRoot }) => {
    const safeProjectRoot = projectRoot ? validateProjectRoot(projectRoot) : undefined;
    return loadKodaxConfigOverview(safeProjectRoot);
  });

  registerChannel('settings.kodaxConfig.setCompaction', async ({ projectRoot, compaction }) => {
    const safeProjectRoot = projectRoot ? validateProjectRoot(projectRoot) : undefined;
    const result = await updateKodaxCompactionConfig(compaction, safeProjectRoot);
    if (runtimeHostAdapter.isRuntimeSelected()) {
      await runtimeHostAdapter.reloadRuntimeConfig().catch((error) => {
        console.warn(
          '[settings.kodaxConfig.setCompaction] Coder daemon config reload failed:',
          error instanceof Error ? error.message : error,
        );
      });
    }
    return result;
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVOKE_CHANNEL_NAMES,
  invokeChannels,
  resolveEffectiveLocale,
  settingsGetChannel,
  settingsKodaxConfigGetChannel,
  settingsKodaxConfigSetCompactionChannel,
  settingsSetDefaultWorkspaceChannel,
  settingsSetLanguageModeChannel,
  settingsSetRuntimeDefaultsChannel,
} from '../src/index.js';

test('settings channels are registered', () => {
  for (const name of [
    'settings.get',
    'settings.setDefaultWorkspace',
    'settings.setLanguageMode',
    'settings.setRuntimeDefaults',
    'settings.kodaxConfig.get',
    'settings.kodaxConfig.setCompaction',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name));
  }
});

test('KodaX config overview channels accept compaction and storage summaries', () => {
  const output = {
    configPath: 'C:\\Users\\you\\.kodax\\config.json',
    configExists: true,
    compaction: { enabled: true, triggerPercent: 65, contextWindow: 200_000 },
    mcp: {
      globalPath: 'C:\\Users\\you\\.kodax\\config.json',
      projectPath: 'C:\\repo\\.kodax\\config.json',
      globalConfigExists: true,
      projectConfigExists: false,
      globalServers: 2,
      projectServers: 0,
    },
    skills: {
      userSkillsDir: 'C:\\Users\\you\\.kodax\\skills',
      projectSkillsDir: 'C:\\repo\\.kodax\\skills',
    },
    errors: [],
  };
  assert.equal(settingsKodaxConfigGetChannel.output.safeParse(output).success, true);
  assert.equal(settingsKodaxConfigSetCompactionChannel.output.safeParse(output).success, true);
  assert.equal(
    settingsKodaxConfigSetCompactionChannel.input.safeParse({
      compaction: { enabled: false, triggerPercent: 60 },
    }).success,
    true,
  );
  assert.equal(
    settingsKodaxConfigSetCompactionChannel.input.safeParse({
      compaction: { triggerPercent: 101 },
    }).success,
    false,
  );
});

test('settings output includes language preference and effective locale', () => {
  const output = {
    defaultWorkspace: '/tmp/kodax',
    languageMode: 'system',
    effectiveLocale: 'zh-CN',
    preferredSystemLanguages: ['zh-CN', 'en-US'],
    runtimeDefaults: {
      permissionMode: 'auto',
      autoModeEngine: 'rules',
      reasoningMode: 'deep',
      agentMode: 'sa',
    },
  };
  assert.equal(settingsGetChannel.output.safeParse(output).success, true);
  assert.equal(settingsSetDefaultWorkspaceChannel.output.safeParse(output).success, true);
  assert.equal(settingsSetLanguageModeChannel.output.safeParse(output).success, true);
  assert.equal(settingsSetRuntimeDefaultsChannel.output.safeParse(output).success, true);
});

test('settings.setRuntimeDefaults accepts runtime defaults and rejects unknown keys', () => {
  assert.equal(
    settingsSetRuntimeDefaultsChannel.input.safeParse({
      runtimeDefaults: {
        permissionMode: 'plan',
        autoModeEngine: 'rules',
        reasoningMode: 'quick',
        agentMode: 'ama',
      },
    }).success,
    true,
  );
  assert.equal(
    settingsSetRuntimeDefaultsChannel.input.safeParse({
      runtimeDefaults: { agentMode: 'amaw' },
    }).success,
    false,
  );
  assert.equal(
    settingsSetRuntimeDefaultsChannel.input.safeParse({
      runtimeDefaults: { permissionMode: 'bypass-permissions' },
    }).success,
    false,
  );
  assert.equal(
    settingsSetRuntimeDefaultsChannel.input.safeParse({
      runtimeDefaults: { permissionMode: 'auto', extra: true },
    }).success,
    false,
  );
});

test('settings.setLanguageMode accepts only supported language modes', () => {
  assert.equal(
    settingsSetLanguageModeChannel.input.safeParse({ languageMode: 'system' }).success,
    true,
  );
  assert.equal(
    settingsSetLanguageModeChannel.input.safeParse({ languageMode: 'zh-CN' }).success,
    true,
  );
  assert.equal(
    settingsSetLanguageModeChannel.input.safeParse({ languageMode: 'en-US' }).success,
    true,
  );
  assert.equal(
    settingsSetLanguageModeChannel.input.safeParse({ languageMode: 'zh-Hant' }).success,
    false,
  );
});

test('resolveEffectiveLocale honors explicit modes', () => {
  assert.equal(resolveEffectiveLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveEffectiveLocale('en-US', ['zh-CN']), 'en-US');
});

test('resolveEffectiveLocale maps system Simplified Chinese variants to zh-CN', () => {
  assert.equal(resolveEffectiveLocale('system', ['zh-CN']), 'zh-CN');
  assert.equal(resolveEffectiveLocale('system', ['zh-Hans-US']), 'zh-CN');
  assert.equal(resolveEffectiveLocale('system', ['zh']), 'zh-CN');
});

test('resolveEffectiveLocale falls back to en-US for unknown and POSIX locales', () => {
  assert.equal(resolveEffectiveLocale('system', ['C']), 'en-US');
  assert.equal(resolveEffectiveLocale('system', ['POSIX']), 'en-US');
  assert.equal(resolveEffectiveLocale('system', ['fr-FR']), 'en-US');
  assert.equal(resolveEffectiveLocale('system', ['zh-Hant-TW']), 'en-US');
  assert.equal(resolveEffectiveLocale('system', []), 'en-US');
});

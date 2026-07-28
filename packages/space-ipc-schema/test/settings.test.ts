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
  settingsSetTerminalShellChannel,
  settingsSetWindowCloseBehaviorChannel,
  settingsSetRuntimeDefaultsChannel,
} from '../src/index.js';

test('settings channels are registered', () => {
  for (const name of [
    'settings.get',
    'settings.setDefaultWorkspace',
    'settings.setLanguageMode',
    'settings.setTerminalShell',
    'settings.setWindowCloseBehavior',
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
    compaction: {
      enabled: true,
      triggerPercent: 65,
      triggerTokens: 120_000,
      contextWindow: 200_000,
    },
    mcp: {
      globalPath: 'C:\\Users\\you\\.kodax\\integrations\\mcp.json',
      projectPath: 'C:\\repo\\.kodax\\integrations\\mcp.json',
      globalSource: 'user',
      projectSource: 'default',
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
    false,
  );
  for (const triggerPercent of [15, 90]) {
    assert.equal(
      settingsKodaxConfigSetCompactionChannel.input.safeParse({
        compaction: { enabled: true, triggerPercent },
      }).success,
      true,
    );
  }
  for (const [triggerPercent, expected] of [
    [14, 15],
    [91, 90],
    [101, 90],
  ]) {
    const parsed = settingsKodaxConfigSetCompactionChannel.input.safeParse({
      compaction: { enabled: true, triggerPercent },
    });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.compaction.triggerPercent, expected);
  }
  for (const triggerTokens of [0, 120_000]) {
    assert.equal(
      settingsKodaxConfigSetCompactionChannel.input.safeParse({
        compaction: { enabled: true, triggerTokens },
      }).success,
      true,
    );
  }
  for (const triggerTokens of [-1, 1.5]) {
    assert.equal(
      settingsKodaxConfigSetCompactionChannel.input.safeParse({
        compaction: { enabled: true, triggerTokens },
      }).success,
      false,
    );
  }
});

test('settings output includes language preference and effective locale', () => {
  const output = {
    defaultWorkspace: '/tmp/kodax',
    languageMode: 'system',
    terminalShell: 'auto',
    windowCloseBehavior: 'ask',
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
  assert.equal(settingsSetTerminalShellChannel.output.safeParse(output).success, true);
  assert.equal(settingsSetWindowCloseBehaviorChannel.output.safeParse(output).success, true);
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

test('settings.setTerminalShell accepts supported shells and rejects arbitrary executables', () => {
  for (const terminalShell of ['auto', 'pwsh', 'powershell', 'cmd', 'bash', 'zsh']) {
    assert.equal(settingsSetTerminalShellChannel.input.safeParse({ terminalShell }).success, true);
  }
  assert.equal(
    settingsSetTerminalShellChannel.input.safeParse({
      terminalShell: 'C:\\Temp\\untrusted-shell.exe',
    }).success,
    false,
  );
});

test('settings.setWindowCloseBehavior accepts only supported close policies', () => {
  for (const windowCloseBehavior of ['ask', 'minimize-to-tray', 'quit-completely']) {
    assert.equal(
      settingsSetWindowCloseBehaviorChannel.input.safeParse({ windowCloseBehavior }).success,
      true,
    );
  }
  assert.equal(
    settingsSetWindowCloseBehaviorChannel.input.safeParse({
      windowCloseBehavior: 'force-kill',
    }).success,
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

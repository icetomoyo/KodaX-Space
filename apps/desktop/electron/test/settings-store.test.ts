import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../settings/store.js';

let tmpDir = '';
let settingsFile = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-space-settings-'));
  settingsFile = path.join(tmpDir, 'settings.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('load backfills languageMode for older settings files', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(
    settingsFile,
    JSON.stringify({ version: 1, defaultWorkspace: path.join(tmpDir, 'workspace') }),
    'utf-8',
  );

  const store = new SettingsStore(settingsFile, tmpDir);
  const loaded = await store.load();

  assert.equal(loaded.defaultWorkspace, path.join(tmpDir, 'workspace'));
  assert.equal(loaded.languageMode, 'system');
  assert.deepEqual(loaded.runtimeDefaults, {});
});

test('setLanguageMode persists without changing defaultWorkspace', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setDefaultWorkspace(workspace);

  const next = await store.setLanguageMode('en-US');
  assert.equal(next.defaultWorkspace, workspace);
  assert.equal(next.languageMode, 'en-US');

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.defaultWorkspace, workspace);
  assert.equal(reloaded.languageMode, 'en-US');
});

test('setRuntimeDefaults merges and persists runtime defaults', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setDefaultWorkspace(workspace);

  const first = await store.setRuntimeDefaults({
    permissionMode: 'auto',
    autoModeEngine: 'rules',
  });
  assert.deepEqual(first.runtimeDefaults, {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
  });

  const merged = await store.setRuntimeDefaults({ reasoningMode: 'deep', agentMode: 'sa' });
  assert.deepEqual(merged.runtimeDefaults, {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    reasoningMode: 'deep',
    agentMode: 'sa',
  });

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.version, 2);
  assert.equal(reloaded.defaultWorkspace, workspace);
  assert.deepEqual(reloaded.runtimeDefaults, merged.runtimeDefaults);
});

test('load preserves valid runtime default fields when one field is invalid', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(
    settingsFile,
    JSON.stringify(
      {
        version: 2,
        defaultWorkspace: workspace,
        languageMode: 'system',
        runtimeDefaults: {
          permissionMode: 'auto',
          reasoningMode: 'turbo',
          agentMode: 'sa',
          extra: true,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir).load();

  assert.deepEqual(loaded.runtimeDefaults, {
    permissionMode: 'auto',
    agentMode: 'sa',
  });
});

test('load migrates the retired persisted AMAW default to AMA', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  await fs.writeFile(
    settingsFile,
    JSON.stringify({
      version: 2,
      defaultWorkspace: workspace,
      languageMode: 'system',
      runtimeDefaults: { agentMode: 'amaw', futureRuntimeField: { enabled: true } },
      futureTopLevelField: 'preserved',
    }),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.deepEqual(loaded.runtimeDefaults, { agentMode: 'ama' });
  const migrated = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    runtimeDefaults: { agentMode: string; futureRuntimeField: unknown };
    futureTopLevelField: string;
  };
  assert.equal(migrated.runtimeDefaults.agentMode, 'ama');
  assert.deepEqual(migrated.runtimeDefaults.futureRuntimeField, { enabled: true });
  assert.equal(migrated.futureTopLevelField, 'preserved');
});

test('load migrates the retired persisted ama-workflow default to AMA', async () => {
  const workspace = path.join(tmpDir, 'workspace-alias');
  await fs.writeFile(
    settingsFile,
    JSON.stringify({
      version: 2,
      defaultWorkspace: workspace,
      languageMode: 'system',
      runtimeDefaults: { agentMode: 'ama-workflow' },
    }),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.deepEqual(loaded.runtimeDefaults, { agentMode: 'ama' });
  const migrated = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    runtimeDefaults: { agentMode: string };
  };
  assert.equal(migrated.runtimeDefaults.agentMode, 'ama');
});

test('setRuntimeDefaults ignores invalid patch fields without dropping existing values', async () => {
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setRuntimeDefaults({ permissionMode: 'auto', reasoningMode: 'quick' });

  const next = await store.setRuntimeDefaults({
    reasoningMode: 'turbo',
    autoModeEngine: 'rules',
  } as never);

  assert.deepEqual(next.runtimeDefaults, {
    permissionMode: 'auto',
    reasoningMode: 'quick',
    autoModeEngine: 'rules',
  });
});

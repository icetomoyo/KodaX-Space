import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replaceFileWithoutFollowingAliases } from '../kodax/atomic-file.js';
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
  assert.equal(loaded.terminalShell, 'auto');
  assert.equal(loaded.windowCloseBehavior, 'ask');
  assert.equal(loaded.coderRuntimeMode, 'daemon');
  assert.deepEqual(loaded.runtimeDefaults, {});

  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    version: number;
    coderRuntimeMode: string;
  };
  assert.equal(persisted.version, 3);
  assert.equal(persisted.coderRuntimeMode, 'daemon');
});

test('load migrates an unset legacy environment selection to embedded mode', async () => {
  await fs.writeFile(
    settingsFile,
    JSON.stringify({
      version: 2,
      defaultWorkspace: path.join(tmpDir, 'workspace'),
      languageMode: 'system',
    }),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir, 'legacy').load();
  assert.equal(loaded.version, 3);
  assert.equal(loaded.coderRuntimeMode, 'embedded');

  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    version: number;
    coderRuntimeMode: string;
  };
  assert.equal(persisted.version, 3);
  assert.equal(persisted.coderRuntimeMode, 'embedded');

  const reloadedWithoutLegacyEnvironment = await new SettingsStore(settingsFile, tmpDir, '').load();
  assert.equal(reloadedWithoutLegacyEnvironment.coderRuntimeMode, 'embedded');
});

test('missing settings persist the legacy environment selection exactly once', async () => {
  const first = await new SettingsStore(settingsFile, tmpDir, 'legacy').load();
  assert.equal(first.coderRuntimeMode, 'embedded');

  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    version: number;
    coderRuntimeMode: string;
  };
  assert.equal(persisted.version, 3);
  assert.equal(persisted.coderRuntimeMode, 'embedded');

  const reloadedWithoutLegacyEnvironment = await new SettingsStore(settingsFile, tmpDir, '').load();
  assert.equal(reloadedWithoutLegacyEnvironment.coderRuntimeMode, 'embedded');
});

test('concurrent missing-settings creators converge on the persisted migration winner', async () => {
  const legacyStore = new SettingsStore(settingsFile, tmpDir, 'legacy');
  const runtimeStore = new SettingsStore(settingsFile, tmpDir, 'runtime');

  const [legacyResult, runtimeResult] = await Promise.all([
    legacyStore.load(),
    runtimeStore.load(),
  ]);
  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    version: number;
    coderRuntimeMode: string;
  };

  assert.equal(persisted.version, 3);
  assert.equal(legacyResult.coderRuntimeMode, persisted.coderRuntimeMode);
  assert.equal(runtimeResult.coderRuntimeMode, persisted.coderRuntimeMode);
});

test('concurrent loads on one store share the same initial read and create', async (t) => {
  const readFileDescriptor = Object.getOwnPropertyDescriptor(fs, 'readFile');
  assert.ok(readFileDescriptor);
  t.after(() => {
    Object.defineProperty(fs, 'readFile', readFileDescriptor);
  });

  const originalReadFile = fs.readFile;
  let readCalls = 0;
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  Object.defineProperty(fs, 'readFile', {
    configurable: true,
    value: async (filePath: string) => {
      readCalls += 1;
      markReadStarted();
      await readGate;
      return originalReadFile(filePath);
    },
  });

  const store = new SettingsStore(settingsFile, tmpDir, 'legacy');
  const firstLoad = store.load();
  await readStarted;
  const secondLoad = store.load();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(readCalls, 1);

  releaseRead();
  const [first, second] = await Promise.all([firstLoad, secondLoad]);
  assert.deepEqual(first, second);
  assert.equal(first.coderRuntimeMode, 'embedded');
});

test('setCoderRuntimeMode persists the explicit customer preference', async () => {
  const store = new SettingsStore(settingsFile, tmpDir);

  const next = await store.setCoderRuntimeMode('embedded');
  assert.equal(next.coderRuntimeMode, 'embedded');

  const reloaded = await new SettingsStore(settingsFile, tmpDir, 'runtime').load();
  assert.equal(reloaded.coderRuntimeMode, 'embedded');
  assert.equal(reloaded.version, 3);
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

test('setTerminalShell persists without changing workspace or language', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setDefaultWorkspace(workspace);
  await store.setLanguageMode('zh-CN');

  const next = await store.setTerminalShell('powershell');
  assert.equal(next.defaultWorkspace, workspace);
  assert.equal(next.languageMode, 'zh-CN');
  assert.equal(next.terminalShell, 'powershell');

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.terminalShell, 'powershell');
});

test('setWindowCloseBehavior persists without changing other preferences', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setDefaultWorkspace(workspace);
  await store.setLanguageMode('zh-CN');
  await store.setTerminalShell('pwsh');

  const next = await store.setWindowCloseBehavior('quit-completely');
  assert.equal(next.defaultWorkspace, workspace);
  assert.equal(next.languageMode, 'zh-CN');
  assert.equal(next.terminalShell, 'pwsh');
  assert.equal(next.windowCloseBehavior, 'quit-completely');
  assert.equal(next.coderRuntimeMode, 'daemon');

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.windowCloseBehavior, 'quit-completely');
  assert.equal(reloaded.coderRuntimeMode, 'daemon');
});

test('concurrent preference setters merge against the latest committed settings', async () => {
  const store = new SettingsStore(settingsFile, tmpDir);

  await Promise.all([
    store.setLanguageMode('zh-CN'),
    store.setWindowCloseBehavior('quit-completely'),
    store.setTerminalShell('pwsh'),
  ]);

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.languageMode, 'zh-CN');
  assert.equal(reloaded.windowCloseBehavior, 'quit-completely');
  assert.equal(reloaded.terminalShell, 'pwsh');
});

test('a failed settings write leaves the last committed value in memory', async () => {
  const store = new SettingsStore(settingsFile, tmpDir);
  const initial = await store.load();
  assert.equal(initial.windowCloseBehavior, 'ask');

  await fs.rm(settingsFile);
  await fs.mkdir(settingsFile);
  await assert.rejects(store.setWindowCloseBehavior('quit-completely'));

  const afterFailure = await store.load();
  assert.equal(afterFailure.windowCloseBehavior, 'ask');
});

test('load normalizes an invalid window close behavior without dropping valid settings', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  await fs.writeFile(
    settingsFile,
    JSON.stringify({
      version: 2,
      defaultWorkspace: workspace,
      languageMode: 'en-US',
      terminalShell: 'bash',
      windowCloseBehavior: 'force-kill',
      runtimeDefaults: { permissionMode: 'auto' },
    }),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(loaded.defaultWorkspace, workspace);
  assert.equal(loaded.languageMode, 'en-US');
  assert.equal(loaded.terminalShell, 'bash');
  assert.equal(loaded.windowCloseBehavior, 'ask');
  assert.deepEqual(loaded.runtimeDefaults, { permissionMode: 'auto' });
});

test('load normalizes an invalid terminal shell without dropping valid settings', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  await fs.writeFile(
    settingsFile,
    JSON.stringify({
      version: 2,
      defaultWorkspace: workspace,
      languageMode: 'en-US',
      terminalShell: 'fish',
      windowCloseBehavior: 'minimize-to-tray',
      runtimeDefaults: { permissionMode: 'auto' },
    }),
    'utf-8',
  );

  const loaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(loaded.defaultWorkspace, workspace);
  assert.equal(loaded.languageMode, 'en-US');
  assert.equal(loaded.terminalShell, 'auto');
  assert.equal(loaded.windowCloseBehavior, 'minimize-to-tray');
  assert.deepEqual(loaded.runtimeDefaults, { permissionMode: 'auto' });
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

  const merged = await store.setRuntimeDefaults({ reasoningMode: 'max', agentMode: 'sa' });
  assert.deepEqual(merged.runtimeDefaults, {
    permissionMode: 'auto',
    autoModeEngine: 'rules',
    reasoningMode: 'max',
    agentMode: 'sa',
  });

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.version, 3);
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

test('settings updates recover from Windows EPERM while replacing the existing file', async (t) => {
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.load();

  const renameDescriptor = Object.getOwnPropertyDescriptor(fs, 'rename');
  assert.ok(renameDescriptor);
  t.after(() => {
    Object.defineProperty(fs, 'rename', renameDescriptor);
  });

  const originalRename = fs.rename;
  let forcedReplacementFailure = false;
  Object.defineProperty(fs, 'rename', {
    configurable: true,
    value: async (source: string, destination: string) => {
      if (!forcedReplacementFailure && destination === settingsFile) {
        forcedReplacementFailure = true;
        throw Object.assign(new Error('forced Windows replacement fallback'), { code: 'EPERM' });
      }
      return originalRename(source, destination);
    },
  });

  const next = await store.setLanguageMode('zh-CN');

  assert.equal(forcedReplacementFailure, true);
  assert.equal(next.languageMode, 'zh-CN');
  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as {
    languageMode: string;
  };
  assert.equal(persisted.languageMode, 'zh-CN');
});

test('Windows replacement fallback retains a directory at the settings path', async (t) => {
  await fs.mkdir(settingsFile);
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.load();

  const renameDescriptor = Object.getOwnPropertyDescriptor(fs, 'rename');
  assert.ok(renameDescriptor);
  t.after(() => {
    Object.defineProperty(fs, 'rename', renameDescriptor);
  });

  const originalRename = fs.rename;
  Object.defineProperty(fs, 'rename', {
    configurable: true,
    value: async (source: string, destination: string) => {
      if (destination === settingsFile) {
        throw Object.assign(new Error('forced Windows replacement fallback'), { code: 'EPERM' });
      }
      return originalRename(source, destination);
    },
  });

  await assert.rejects(store.setLanguageMode('zh-CN'), /unsafe existing entry retained/);
  assert.equal((await fs.lstat(settingsFile)).isDirectory(), true);
});

test('Windows replacement fallback retains a symbolic link at the settings path', async (t) => {
  const outsideFile = path.join(tmpDir, 'outside-settings.json');
  await fs.writeFile(
    outsideFile,
    JSON.stringify({
      version: 3,
      defaultWorkspace: path.join(tmpDir, 'workspace'),
      languageMode: 'system',
      terminalShell: 'auto',
      windowCloseBehavior: 'ask',
      coderRuntimeMode: 'daemon',
      runtimeDefaults: {},
    }),
    'utf-8',
  );
  try {
    await fs.symlink(outsideFile, settingsFile, 'file');
  } catch (error) {
    t.skip(`symlink unavailable on this Windows environment: ${String(error)}`);
    return;
  }

  const store = new SettingsStore(settingsFile, tmpDir);
  await store.load();
  const renameDescriptor = Object.getOwnPropertyDescriptor(fs, 'rename');
  assert.ok(renameDescriptor);
  t.after(() => {
    Object.defineProperty(fs, 'rename', renameDescriptor);
  });

  const originalRename = fs.rename;
  Object.defineProperty(fs, 'rename', {
    configurable: true,
    value: async (source: string, destination: string) => {
      if (destination === settingsFile) {
        throw Object.assign(new Error('forced Windows replacement fallback'), { code: 'EPERM' });
      }
      return originalRename(source, destination);
    },
  });

  await assert.rejects(store.setLanguageMode('zh-CN'), /unsafe existing entry retained/);
  assert.equal((await fs.lstat(settingsFile)).isSymbolicLink(), true);
  const outside = JSON.parse(await fs.readFile(outsideFile, 'utf-8')) as {
    languageMode: string;
  };
  assert.equal(outside.languageMode, 'system');
});

test('Windows replacement fallback restores a directory raced in after preflight', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows rename fallback only');
    return;
  }
  await fs.writeFile(settingsFile, 'previous settings', 'utf-8');

  await assert.rejects(
    replaceFileWithoutFollowingAliases(
      settingsFile,
      Buffer.from('replacement settings', 'utf-8'),
      'settings changed during update',
      {
        forceRenameFallback: true,
        beforeFallbackDisplace: async () => {
          await fs.unlink(settingsFile);
          await fs.mkdir(settingsFile);
        },
      },
    ),
    /unsafe previous entry/,
  );

  assert.equal((await fs.lstat(settingsFile)).isDirectory(), true);
  const siblings = await fs.readdir(tmpDir);
  assert.equal(
    siblings.some((name) => name.includes('.kodax-atomic-')),
    false,
  );
});

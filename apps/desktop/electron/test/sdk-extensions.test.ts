import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSpaceSdkExtensionRuntime,
  disposeActiveSpaceSdkExtensionRuntime,
  getSpaceSdkExtensionConfigGeneration,
  hasEnabledMcpServers,
  invalidateSpaceSdkExtensionRuntimes,
  sdkExtensionsEnabledByEnv,
} from '../kodax/sdk-extensions.js';
import { loadKodaxProjectMcpServers } from '../mcp/kodax-user-config-loader.js';

type FakeRuntime = {
  activated: boolean;
  disposed: boolean;
  loadedExtensions: Array<{ paths: string[]; options: unknown }>;
  activate(): FakeRuntime;
  dispose(): Promise<void>;
  loadExtensions(paths: string[], options?: unknown): Promise<void>;
  getDiagnostics(): { activated: boolean; loadedExtensions: number };
};

function createFakeRuntime(): FakeRuntime {
  return {
    activated: false,
    disposed: false,
    loadedExtensions: [],
    activate() {
      this.activated = true;
      return this;
    },
    async dispose() {
      this.disposed = true;
    },
    async loadExtensions(paths: string[], options?: unknown) {
      this.loadedExtensions.push({ paths, options });
    },
    getDiagnostics() {
      return { activated: this.activated, loadedExtensions: this.loadedExtensions.length };
    },
  };
}

function makeFakeSdk(
  calls: Record<string, unknown> = {},
  options: { freshRuntimePerCreate?: boolean } = {},
) {
  let activeRuntime: unknown = null;
  const sharedRuntime = createFakeRuntime();
  const runtimes: FakeRuntime[] = [];

  function nextRuntime(): FakeRuntime {
    const runtime = options.freshRuntimePerCreate ? createFakeRuntime() : sharedRuntime;
    if (!runtimes.includes(runtime)) runtimes.push(runtime);
    calls.runtimes = runtimes;
    return runtime;
  }

  const sdk = {
    createExtensionRuntime(createOptions: unknown) {
      calls.createOptions = createOptions;
      return nextRuntime();
    },
    async registerConfiguredMcpCapabilityProvider(
      rt: unknown,
      servers: unknown,
      providerOptions?: unknown,
    ) {
      calls.register = { runtime: rt, servers, options: providerOptions };
      return { id: 'mcp' };
    },
    buildMcpReverseCapabilities(workspace: unknown) {
      calls.reverseWorkspace = workspace;
      return { listRoots: () => [] };
    },
    getDefaultExtensionDirectory() {
      return 'C:/Users/test/.kodax/extensions';
    },
    async discoverExtensionsInDirectoryDetailed(directory: string) {
      calls.discoverDirectory = directory;
      return { skipped: [] };
    },
    async discoverDefaultExtensions() {
      return ['C:/Users/test/.kodax/extensions/one.js'];
    },
    async dedupeExtensionPathsByEntrypoint(paths: string[]) {
      calls.dedupePaths = paths;
      return [...new Set(paths)];
    },
    getActiveExtensionRuntime() {
      return activeRuntime;
    },
    setActiveExtensionRuntime(next: unknown) {
      activeRuntime = next;
    },
  };

  return {
    sdk,
    runtime: sharedRuntime,
    getActiveRuntime: () => activeRuntime,
    getRuntimes: () => runtimes,
  };
}

test('sdkExtensionsEnabledByEnv accepts common truthy values only', () => {
  assert.equal(sdkExtensionsEnabledByEnv({ KODAX_SPACE_ENABLE_SDK_EXTENSIONS: '1' }), true);
  assert.equal(sdkExtensionsEnabledByEnv({ KODAX_SPACE_ENABLE_SDK_EXTENSIONS: 'yes' }), true);
  assert.equal(sdkExtensionsEnabledByEnv({ KODAX_SPACE_ENABLE_SDK_EXTENSIONS: 'false' }), false);
  assert.equal(sdkExtensionsEnabledByEnv({}), false);
});

test('hasEnabledMcpServers ignores missing and disabled servers', () => {
  assert.equal(hasEnabledMcpServers(undefined), false);
  assert.equal(hasEnabledMcpServers({ disabled: { connect: 'disabled' } } as never), false);
  assert.equal(hasEnabledMcpServers({ malformed: null, list: [] } as never), false);
  assert.equal(hasEnabledMcpServers({ lazy: { command: 'node' } } as never), true);
  assert.equal(
    hasEnabledMcpServers({ prewarm: { url: 'https://mcp.example', connect: 'prewarm' } } as never),
    true,
  );
});

test('loadKodaxProjectMcpServers reads raw project-level MCP config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-project-mcp-'));
  try {
    await mkdir(path.join(root, '.kodax', 'integrations'), { recursive: true });
    await writeFile(
      path.join(root, '.kodax', 'integrations', 'mcp.json'),
      JSON.stringify({
        version: 1,
        servers: {
          project: {
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: 'secret' },
          },
        },
      }),
      'utf8',
    );

    const servers = await loadKodaxProjectMcpServers(root);

    assert.deepEqual((servers as Record<string, unknown> | undefined)?.project, {
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'secret' },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadKodaxProjectMcpServers retains the SDK legacy config fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-project-mcp-legacy-'));
  try {
    await mkdir(path.join(root, '.kodax'), { recursive: true });
    await writeFile(
      path.join(root, '.kodax', 'config.json'),
      JSON.stringify({ mcpServers: { legacy: { command: 'legacy-server' } } }),
      'utf8',
    );

    const servers = await loadKodaxProjectMcpServers(root);

    assert.deepEqual((servers as Record<string, unknown> | undefined)?.legacy, {
      command: 'legacy-server',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadKodaxProjectMcpServers rejects invalid split integration JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-project-mcp-invalid-'));
  try {
    await mkdir(path.join(root, '.kodax', 'integrations'), { recursive: true });
    await writeFile(
      path.join(root, '.kodax', 'integrations', 'mcp.json'),
      '{ "version": 1, "servers": secret-fragment }',
      'utf8',
    );

    await assert.rejects(
      () => loadKodaxProjectMcpServers(root),
      (err: unknown) => err instanceof Error && /Invalid JSON/.test(err.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createSpaceSdkExtensionRuntime returns undefined without MCP or enabled filesystem extensions', async () => {
  let sdkLoaded = false;
  const handle = await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/no-mcp' },
    {
      loadMcpServers: async () => undefined,
      loadSdkCoding: async () => {
        sdkLoaded = true;
        return makeFakeSdk().sdk as never;
      },
      env: {},
    },
  );

  assert.equal(handle, undefined);
  assert.equal(sdkLoaded, false);
});

test('createSpaceSdkExtensionRuntime registers configured MCP provider with project roots', async () => {
  const calls: Record<string, unknown> = {};
  const { sdk, runtime } = makeFakeSdk(calls);
  const servers = { gitnexus: { command: 'git-nexus', args: ['mcp'] } };
  let receivedProjectRoot = '';

  const handle = await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/space' },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async (projectRoot) => {
        receivedProjectRoot = projectRoot;
        return servers as never;
      },
      env: {},
    },
  );

  assert.ok(handle);
  assert.equal(receivedProjectRoot, 'C:/repo/space');
  assert.equal(handle.runtime, runtime);
  assert.equal(handle.mcpProviderRegistered, true);
  assert.equal(runtime.activated, true);
  assert.deepEqual(runtime.loadedExtensions, []);
  assert.deepEqual(calls.createOptions, { config: { host: 'kodax-space' } });
  assert.deepEqual(calls.reverseWorkspace, {
    cwd: 'C:/repo/space',
    enableElicitation: true,
  });
  assert.equal((calls.register as { runtime: unknown }).runtime, runtime);
  assert.equal((calls.register as { servers: unknown }).servers, servers);
});

test('createSpaceSdkExtensionRuntime disposes runtime when MCP provider registration fails', async () => {
  const { sdk, runtime } = makeFakeSdk();
  const failingSdk = {
    ...sdk,
    async registerConfiguredMcpCapabilityProvider() {
      throw new Error('provider failed');
    },
  };

  await assert.rejects(
    createSpaceSdkExtensionRuntime(
      { projectRoot: 'C:/repo/space' },
      {
        loadSdkCoding: async () => failingSdk as never,
        loadMcpServers: async () => ({ mcp: { command: 'node' } }) as never,
        env: {},
      },
    ),
    /provider failed/,
  );

  assert.equal(runtime.disposed, true);
});

test('createSpaceSdkExtensionRuntime replaces and disposes active runtimes only when requested', async () => {
  const calls: Record<string, unknown> = {};
  const { sdk, getActiveRuntime, getRuntimes } = makeFakeSdk(calls, {
    freshRuntimePerCreate: true,
  });

  await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/space' },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async () => ({ mcp: { command: 'node' } }) as never,
      env: {},
    },
  );
  assert.equal(getActiveRuntime(), null);

  await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/space', setActive: true },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async () => ({ mcp: { command: 'node' } }) as never,
      env: {},
    },
  );
  const firstActive = getRuntimes()[1];
  assert.equal(getActiveRuntime(), firstActive);
  assert.equal(firstActive?.disposed, false);

  await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/space', setActive: true },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async () => ({ mcp: { command: 'node' } }) as never,
      env: {},
    },
  );
  const secondActive = getRuntimes()[2];
  assert.equal(firstActive?.disposed, true);
  assert.equal(getActiveRuntime(), secondActive);
  assert.equal(secondActive?.disposed, false);

  await disposeActiveSpaceSdkExtensionRuntime({ loadSdkCoding: async () => sdk as never });
  assert.equal(secondActive?.disposed, true);
  assert.equal(getActiveRuntime(), null);
});

test('invalidateSpaceSdkExtensionRuntimes increments generation and disposes active runtime', async () => {
  const { sdk, getActiveRuntime, getRuntimes } = makeFakeSdk({}, { freshRuntimePerCreate: true });
  const before = getSpaceSdkExtensionConfigGeneration();

  await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/space', setActive: true },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async () => ({ mcp: { command: 'node' } }) as never,
      env: {},
    },
  );
  const active = getRuntimes()[0];
  assert.equal(getActiveRuntime(), active);

  const after = await invalidateSpaceSdkExtensionRuntimes({
    loadSdkCoding: async () => sdk as never,
  });

  assert.equal(after, before + 1);
  assert.equal(active?.disposed, true);
  assert.equal(getActiveRuntime(), null);
});

test('createSpaceSdkExtensionRuntime loads filesystem extensions only when env-enabled', async () => {
  const calls: Record<string, unknown> = {};
  const { sdk, runtime } = makeFakeSdk(calls);

  const handle = await createSpaceSdkExtensionRuntime(
    { projectRoot: 'C:/repo/extensions' },
    {
      loadSdkCoding: async () => sdk as never,
      loadMcpServers: async () => undefined,
      loadConfiguredExtensionPaths: async () => [
        'C:/Users/test/.kodax/managed/one.mjs',
        'C:/Users/test/.kodax/extensions/one.js',
      ],
      env: { KODAX_SPACE_ENABLE_SDK_EXTENSIONS: 'true' },
    },
  );

  assert.ok(handle);
  assert.equal(handle.mcpProviderRegistered, false);
  assert.equal(handle.discovery?.defaultDirectory, 'C:/Users/test/.kodax/extensions');
  assert.deepEqual(runtime.loadedExtensions, [
    {
      paths: ['C:/Users/test/.kodax/extensions/one.js', 'C:/Users/test/.kodax/managed/one.mjs'],
      options: { continueOnError: true, loadSource: 'discovery' },
    },
  ]);
  assert.equal(calls.discoverDirectory, 'C:/Users/test/.kodax/extensions');
  assert.deepEqual(calls.dedupePaths, [
    'C:/Users/test/.kodax/extensions/one.js',
    'C:/Users/test/.kodax/managed/one.mjs',
    'C:/Users/test/.kodax/extensions/one.js',
  ]);
});

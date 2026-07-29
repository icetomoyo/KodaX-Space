// MCP Manager cache for main-process lifecycle IPC.
//
// The SDK agent runtime owns its per-turn MCP capability provider separately. This
// module backs the MCP popout lifecycle APIs: list/start/stop/logs/tools/reload.
// It keeps managers scoped by projectRoot so project-level .kodax/integrations/mcp.json
// servers are startable from the panel, while preserving the old global scope
// when no projectRoot is supplied.

import path from 'node:path';
import {
  loadKodaxMcpServersForProjectStrict,
  loadKodaxUserConfig,
} from './kodax-user-config-loader.js';

type AgentMcpModule = typeof import('@kodax-ai/kodax/mcp');
type ManagerInstance = InstanceType<AgentMcpModule['McpManager']>;

type ManagerCacheEntry = {
  readonly scope: ManagerScope;
  readonly manager: ManagerInstance;
};

type ManagerScope = {
  readonly key: string;
  readonly projectRoot?: string;
};

const GLOBAL_SCOPE_KEY = 'global';

const cached = new Map<string, ManagerCacheEntry>();
const lastConstructError = new Map<string, string>();
const initPromises = new Map<string, Promise<ManagerInstance>>();
let initGeneration = 0;
let shuttingDown = false;
let reloadTail: Promise<void> = Promise.resolve();
let reloadBarrier: Promise<void> | null = null;

export interface McpManagerTestDependencies {
  readonly loadModule: () => Promise<unknown>;
  readonly loadGlobalServers: () => Promise<unknown>;
  readonly loadProjectServers: (projectRoot: string) => Promise<unknown>;
  readonly createManager: (module: unknown, servers: unknown) => unknown;
}

let testDependencies: McpManagerTestDependencies | null = null;

export function setMcpManagerTestDependencies(
  dependencies: McpManagerTestDependencies | null,
): void {
  if (cached.size > 0 || initPromises.size > 0 || reloadBarrier !== null) {
    throw new Error('Dispose McpManager state before changing test dependencies.');
  }
  testDependencies = dependencies;
  shuttingDown = false;
  initGeneration += 1;
  lastConstructError.clear();
}

function normalizeScope(projectRoot?: string): ManagerScope {
  if (projectRoot === undefined || projectRoot.trim() === '') return { key: GLOBAL_SCOPE_KEY };
  if (!path.isAbsolute(projectRoot)) {
    throw new Error('McpManager projectRoot must be absolute');
  }
  const root = path.resolve(projectRoot);
  return { key: 'project:' + root, projectRoot: root };
}

async function loadServersForScope(scope: ManagerScope): Promise<unknown> {
  if (testDependencies !== null) {
    return scope.projectRoot === undefined
      ? testDependencies.loadGlobalServers()
      : testDependencies.loadProjectServers(scope.projectRoot);
  }
  if (scope.projectRoot !== undefined) {
    return loadKodaxMcpServersForProjectStrict(scope.projectRoot);
  }
  return loadKodaxUserConfig();
}

function optionsForScope(scope: ManagerScope): { readonly projectRoot?: string } | undefined {
  return scope.projectRoot !== undefined ? { projectRoot: scope.projectRoot } : undefined;
}

async function constructManagerEntry(scope: ManagerScope): Promise<ManagerCacheEntry> {
  const mod =
    testDependencies !== null
      ? await testDependencies.loadModule()
      : await import('@kodax-ai/kodax/mcp');
  const servers = await loadServersForScope(scope);
  const candidate =
    testDependencies !== null
      ? testDependencies.createManager(mod, servers)
      : new (mod as AgentMcpModule).McpManager(servers as never);
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { dispose?: unknown }).dispose !== 'function'
  ) {
    throw new Error('McpManager constructor returned an invalid manager.');
  }
  return {
    scope,
    manager: candidate as ManagerInstance,
  };
}

async function waitForReloads(): Promise<void> {
  while (reloadBarrier !== null) {
    const pending = reloadBarrier;
    await pending;
    if (reloadBarrier === pending) return;
  }
}

/**
 * Return the current Manager instance for a scope. The no-project call preserves
 * the original global behavior; projectRoot scopes merge global + project MCP.
 */
export async function getMcpManager(options?: {
  readonly projectRoot?: string;
}): Promise<ManagerInstance> {
  await waitForReloads();
  if (shuttingDown) {
    throw new Error('McpManager unavailable: shutting down');
  }

  const scope = normalizeScope(options?.projectRoot);
  const existing = cached.get(scope.key);
  if (existing !== undefined) return existing.manager;

  const lastError = lastConstructError.get(scope.key);
  if (lastError !== undefined) {
    throw new Error('McpManager unavailable: ' + lastError);
  }

  const existingInit = initPromises.get(scope.key);
  if (existingInit !== undefined) return existingInit;

  const generation = initGeneration;
  let promise: Promise<ManagerInstance> | null = null;
  promise = (async (): Promise<ManagerInstance> => {
    try {
      const entry = await constructManagerEntry(scope);
      const manager = entry.manager;

      if (generation !== initGeneration) {
        await manager.dispose().catch(() => undefined);
        if (shuttingDown) {
          throw new Error('McpManager init cancelled by shutdown');
        }
        return getMcpManager(optionsForScope(scope));
      }

      cached.set(scope.key, entry);
      return manager;
    } catch (err) {
      if (generation !== initGeneration) {
        if (shuttingDown) {
          throw new Error('McpManager init cancelled by shutdown');
        }
        return getMcpManager(optionsForScope(scope));
      }
      const msg = err instanceof Error ? err.message : String(err);
      lastConstructError.set(scope.key, msg);
      throw new Error('McpManager init failed: ' + msg);
    } finally {
      if (generation === initGeneration && initPromises.get(scope.key) === promise) {
        initPromises.delete(scope.key);
      }
    }
  })();
  initPromises.set(scope.key, promise);
  return promise;
}

async function disposeEntries(entries: readonly ManagerCacheEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => entry.manager.dispose().catch(() => undefined)));
}

/**
 * Build every active scope against fresh config, then swap all candidates in
 * one commit. A parse/construct failure disposes only the candidates and keeps
 * every previous manager live as the Space-side last-known-good set.
 */
export function reloadMcpManager(options?: {
  readonly projectRoot?: string;
}): Promise<ManagerInstance> {
  const requestedScope = normalizeScope(options?.projectRoot);
  const previousTail = reloadTail;
  const operation = previousTail.then(async () => {
    if (shuttingDown) {
      throw new Error('McpManager unavailable: shutting down');
    }
    await Promise.allSettled([...initPromises.values()]);
    if (shuttingDown) {
      throw new Error('McpManager unavailable: shutting down');
    }

    const scopes = new Map<string, ManagerScope>();
    for (const entry of cached.values()) scopes.set(entry.scope.key, entry.scope);
    scopes.set(requestedScope.key, requestedScope);
    const results = await Promise.allSettled(
      [...scopes.values()].map((scope) => constructManagerEntry(scope)),
    );
    const candidates = results
      .filter(
        (result): result is PromiseFulfilledResult<ManagerCacheEntry> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure !== undefined) {
      await disposeEntries(candidates);
      throw failure.reason;
    }
    if (shuttingDown) {
      await disposeEntries(candidates);
      throw new Error('McpManager reload cancelled by shutdown');
    }

    initGeneration += 1;
    const previous = [...cached.values()];
    cached.clear();
    for (const entry of candidates) cached.set(entry.scope.key, entry);
    lastConstructError.clear();
    await disposeEntries(previous);
    const requested = cached.get(requestedScope.key);
    if (requested === undefined) {
      throw new Error('McpManager reload did not construct the requested scope.');
    }
    return requested.manager;
  });
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  reloadTail = settled;
  reloadBarrier = settled;
  void settled.then(() => {
    if (reloadBarrier === settled) reloadBarrier = null;
  });
  return operation;
}

/** Release stdio transports and prevent new managers during app shutdown. */
export async function disposeMcpManager(): Promise<void> {
  shuttingDown = true;
  initGeneration += 1;
  const pendingReload = reloadBarrier;
  if (pendingReload !== null) await pendingReload;
  await Promise.allSettled([...initPromises.values()]);
  const previous = [...cached.values()];
  cached.clear();
  initPromises.clear();
  lastConstructError.clear();
  await disposeEntries(previous);
}

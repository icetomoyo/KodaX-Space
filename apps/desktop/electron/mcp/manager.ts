// MCP Manager cache for main-process lifecycle IPC.
//
// The SDK agent runtime owns its per-turn MCP capability provider separately. This
// module backs the MCP popout lifecycle APIs: list/start/stop/logs/tools/reload.
// It keeps managers scoped by projectRoot so project-level .kodax/integrations/mcp.json
// servers are startable from the panel, while preserving the old global scope
// when no projectRoot is supplied.

import path from 'node:path';
import { loadKodaxMcpServersForProject, loadKodaxUserConfig } from './kodax-user-config-loader.js';

type AgentMcpModule = typeof import('@kodax-ai/kodax/mcp');
type ManagerInstance = InstanceType<AgentMcpModule['McpManager']>;

type ManagerCacheEntry = {
  readonly module: AgentMcpModule;
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

function normalizeScope(projectRoot?: string): ManagerScope {
  if (projectRoot === undefined || projectRoot.trim() === '') return { key: GLOBAL_SCOPE_KEY };
  if (!path.isAbsolute(projectRoot)) {
    throw new Error('McpManager projectRoot must be absolute');
  }
  const root = path.resolve(projectRoot);
  return { key: 'project:' + root, projectRoot: root };
}

async function loadServersForScope(scope: ManagerScope): Promise<unknown> {
  if (scope.projectRoot !== undefined) {
    return loadKodaxMcpServersForProject(scope.projectRoot).catch((err) => {
      console.warn(
        '[mcp-manager] project-scoped MCP config load failed:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    });
  }
  return loadKodaxUserConfig().catch((err) => {
    console.warn(
      '[mcp-manager] global MCP config load failed:',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  });
}

function optionsForScope(scope: ManagerScope): { readonly projectRoot?: string } | undefined {
  return scope.projectRoot !== undefined ? { projectRoot: scope.projectRoot } : undefined;
}

/**
 * Return the current Manager instance for a scope. The no-project call preserves
 * the original global behavior; projectRoot scopes merge global + project MCP.
 */
export async function getMcpManager(options?: {
  readonly projectRoot?: string;
}): Promise<ManagerInstance> {
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
      const mod = await import('@kodax-ai/kodax/mcp');
      const servers = await loadServersForScope(scope);
      const manager = new mod.McpManager(servers as never);

      if (generation !== initGeneration) {
        await manager.dispose().catch(() => undefined);
        if (shuttingDown) {
          throw new Error('McpManager init cancelled by shutdown');
        }
        return getMcpManager(optionsForScope(scope));
      }

      cached.set(scope.key, { module: mod, manager });
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
 * User changed config. Drop all scoped managers; next getMcpManager call rebuilds
 * the requested scope with fresh global/project config.
 */
export async function reloadMcpManager(): Promise<void> {
  shuttingDown = false;
  initGeneration += 1;
  const previous = [...cached.values()];
  cached.clear();
  lastConstructError.clear();
  initPromises.clear();
  await disposeEntries(previous);
}

/** Release stdio transports and prevent new managers during app shutdown. */
export async function disposeMcpManager(): Promise<void> {
  shuttingDown = true;
  initGeneration += 1;
  const previous = [...cached.values()];
  cached.clear();
  initPromises.clear();
  lastConstructError.clear();
  await disposeEntries(previous);
}

import path from 'node:path';
import { getKodaxRuntimeDir } from '../kodax/data-paths.js';

// Loads KodaX MCP config for McpManager and the SDK extension runtime.
//
// This differs from mcp/config-reader.ts: that path returns projected McpServerMeta[]
// for mcp.discover and strips env values. This path returns raw SDK McpServersConfig,
// preserving command / args / env / url / headers so transports can actually start.
//
// KodaX 0.7.77 stores MCP declarations in integrations/mcp.json. The SDK reader
// keeps a read-only fallback to legacy config.json#mcpServers until migration.
// Space uses the SDK reader for both the user config home and its project-scoped
// compatibility layer so the split-file contract stays single-sourced.

type SdkReplModule = typeof import('@kodax-ai/kodax/repl');
type McpServersConfig = ReturnType<SdkReplModule['listMcpServers']>;
export type KodaxMcpIntegrationSnapshot = ReturnType<SdkReplModule['readMcpIntegration']>;

let sdkReplCache: SdkReplModule | null = null;

/** Lazy-load the public integration-config reader and MCP CRUD facade. */
async function loadSdkRepl(): Promise<SdkReplModule> {
  if (sdkReplCache === null) {
    sdkReplCache = await import('@kodax-ai/kodax/repl');
  }
  return sdkReplCache;
}

export function getKodaxMcpIntegrationPath(configHome: string): string {
  return path.join(configHome, 'integrations', 'mcp.json');
}

export async function readKodaxMcpIntegration(
  configHome: string,
): Promise<KodaxMcpIntegrationSnapshot> {
  const sdk = await loadSdkRepl();
  return sdk.readMcpIntegration(configHome);
}

/**
 * Read the user-level MCP integration. The SDK returns source=user for the
 * split file, source=legacy-user for config.json#mcpServers fallback, and an
 * empty default document when neither exists.
 */
export async function loadKodaxUserConfig(): Promise<McpServersConfig | undefined> {
  const snapshot = await readKodaxMcpIntegration(getKodaxRuntimeDir());
  const servers = snapshot.document.servers;
  return Object.keys(servers).length > 0 ? servers : undefined;
}

export async function loadKodaxProjectMcpServers(
  projectRoot: string,
): Promise<McpServersConfig | undefined> {
  if (!path.isAbsolute(projectRoot)) return undefined;

  const projectConfigHome = path.join(path.resolve(projectRoot), '.kodax');
  if (path.resolve(projectConfigHome) === path.resolve(getKodaxRuntimeDir())) return undefined;

  const snapshot = await readKodaxMcpIntegration(projectConfigHome);
  const servers = snapshot.document.servers;
  return Object.keys(servers).length > 0 ? servers : undefined;
}

export async function loadKodaxMcpServersForProject(
  projectRoot: string,
): Promise<McpServersConfig | undefined> {
  const [globalServers, projectServers] = await Promise.all([
    loadKodaxUserConfig().catch((err) => {
      console.warn(
        '[kodax-user-config] global MCP config ignored:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }),
    loadKodaxProjectMcpServers(projectRoot).catch((err) => {
      console.warn(
        '[kodax-user-config] project MCP config ignored:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }),
  ]);

  if (!globalServers) return projectServers;
  if (!projectServers) return globalServers;
  return { ...globalServers, ...projectServers } as McpServersConfig;
}

/**
 * Strict variant for an explicit reload transaction. Any invalid global or
 * project document rejects the candidate so callers can retain their previous
 * last-known-good manager instead of silently replacing it with a partial set.
 */
export async function loadKodaxMcpServersForProjectStrict(
  projectRoot: string,
): Promise<McpServersConfig | undefined> {
  const [globalServers, projectServers] = await Promise.all([
    loadKodaxUserConfig(),
    loadKodaxProjectMcpServers(projectRoot),
  ]);
  if (!globalServers) return projectServers;
  if (!projectServers) return globalServers;
  return { ...globalServers, ...projectServers } as McpServersConfig;
}

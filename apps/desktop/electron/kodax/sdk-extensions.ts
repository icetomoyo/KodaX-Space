import { getKodaxRuntimeDir } from './data-paths.js';

type SdkCodingModule = typeof import('@kodax-ai/kodax/coding');
type SpaceSdkExtensionRuntime = ReturnType<SdkCodingModule['createExtensionRuntime']>;
type SpaceSdkExtensionDiagnostics = ReturnType<SpaceSdkExtensionRuntime['getDiagnostics']>;
type SpaceSdkMcpServersConfig = Parameters<
  SdkCodingModule['registerConfiguredMcpCapabilityProvider']
>[1];

type SpaceSdkExtensionDiscovery = {
  readonly defaultDirectory: string;
  readonly paths: readonly string[];
  readonly skipped: readonly {
    readonly path: string;
    readonly reason: string;
    readonly message: string;
  }[];
};

export interface SpaceSdkExtensionRuntimeHandle {
  readonly runtime: SpaceSdkExtensionRuntime;
  readonly discovery: SpaceSdkExtensionDiscovery | undefined;
  readonly diagnostics: SpaceSdkExtensionDiagnostics;
  readonly mcpProviderRegistered: boolean;
}

export interface CreateSpaceSdkExtensionRuntimeOptions {
  readonly projectRoot: string;
  readonly enableElicitation?: boolean;
  readonly setActive?: boolean;
}

export interface SpaceSdkExtensionRuntimeDeps {
  readonly loadSdkCoding?: () => Promise<SdkCodingModule>;
  readonly loadMcpServers?: (projectRoot: string) => Promise<SpaceSdkMcpServersConfig | undefined>;
  readonly loadConfiguredExtensionPaths?: () => Promise<readonly string[]>;
  readonly env?: NodeJS.ProcessEnv;
}

let sdkCodingModule: Promise<SdkCodingModule> | null = null;
let extensionConfigGeneration = 0;
let activeRuntimeSetBySpace: SpaceSdkExtensionRuntime | undefined = undefined;
const runtimeDisposePromises = new WeakMap<object, Promise<void>>();

async function disposeRuntimeOnce(
  runtime: SpaceSdkExtensionRuntime,
  context: string,
): Promise<void> {
  const runtimeKey = runtime as object;
  const existing = runtimeDisposePromises.get(runtimeKey);
  if (existing) {
    await existing;
    return;
  }
  const disposePromise = runtime.dispose().catch((err) => {
    console.warn(
      `[sdk-extensions] ${context} SDK extension runtime dispose failed:`,
      err instanceof Error ? err.message : err,
    );
  });
  runtimeDisposePromises.set(runtimeKey, disposePromise);
  await disposePromise;
}

export function loadSpaceSdkCoding(): Promise<SdkCodingModule> {
  sdkCodingModule ??= import('@kodax-ai/kodax/coding');
  return sdkCodingModule;
}

export function sdkExtensionsEnabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.KODAX_SPACE_ENABLE_SDK_EXTENSIONS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function getSdk(deps?: SpaceSdkExtensionRuntimeDeps): Promise<SdkCodingModule> {
  return deps?.loadSdkCoding ? deps.loadSdkCoding() : loadSpaceSdkCoding();
}

async function loadConfiguredMcpServers(
  projectRoot: string,
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<SpaceSdkMcpServersConfig | undefined> {
  if (deps?.loadMcpServers) return deps.loadMcpServers(projectRoot);
  const { loadKodaxMcpServersForProject } = await import('../mcp/kodax-user-config-loader.js');
  return loadKodaxMcpServersForProject(projectRoot) as Promise<
    SpaceSdkMcpServersConfig | undefined
  >;
}

export function getSpaceSdkExtensionConfigGeneration(): number {
  return extensionConfigGeneration;
}

async function replaceActiveSpaceRuntime(
  sdk: SdkCodingModule,
  runtime: SpaceSdkExtensionRuntime,
): Promise<void> {
  const previous = activeRuntimeSetBySpace;
  if (previous !== undefined && previous !== runtime) {
    if (sdk.getActiveExtensionRuntime() === previous) {
      sdk.setActiveExtensionRuntime(null);
    }
    await disposeRuntimeOnce(previous, 'previous active');
  }
  sdk.setActiveExtensionRuntime(runtime);
  activeRuntimeSetBySpace = runtime;
}

export async function disposeActiveSpaceSdkExtensionRuntime(
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<void> {
  const runtime = activeRuntimeSetBySpace;
  activeRuntimeSetBySpace = undefined;
  if (runtime === undefined) return;
  const sdk = await getSdk(deps);
  if (sdk.getActiveExtensionRuntime() === runtime) {
    sdk.setActiveExtensionRuntime(null);
  }
  await disposeRuntimeOnce(runtime, 'active');
}

export async function invalidateSpaceSdkExtensionRuntimes(
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<number> {
  extensionConfigGeneration += 1;
  await disposeActiveSpaceSdkExtensionRuntime(deps);
  return extensionConfigGeneration;
}

export function hasEnabledMcpServers(servers: SpaceSdkMcpServersConfig | undefined): boolean {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return false;
  return Object.values(servers as Record<string, unknown>).some((server) => {
    if (!server || typeof server !== 'object' || Array.isArray(server)) return false;
    const connect = (server as { readonly connect?: unknown }).connect;
    return (connect ?? 'lazy') !== 'disabled';
  });
}

export async function discoverSpaceSdkExtensions(
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<SpaceSdkExtensionDiscovery> {
  const sdk = await getSdk(deps);
  const defaultDirectory = sdk.getDefaultExtensionDirectory();
  const detailed = await sdk.discoverExtensionsInDirectoryDetailed(defaultDirectory);
  const defaultPaths = await sdk.discoverDefaultExtensions();
  let configuredPaths: readonly string[] = [];
  try {
    if (deps?.loadConfiguredExtensionPaths) {
      configuredPaths = await deps.loadConfiguredExtensionPaths();
    } else {
      const repl = await import('@kodax-ai/kodax/repl');
      configuredPaths = repl.readExtensionsIntegration(getKodaxRuntimeDir()).document.paths;
    }
  } catch (err) {
    console.warn(
      '[sdk-extensions] integrations/extensions.json ignored:',
      err instanceof Error ? err.message : err,
    );
  }
  const paths = await sdk.dedupeExtensionPathsByEntrypoint([...defaultPaths, ...configuredPaths]);
  return { defaultDirectory, paths, skipped: detailed.skipped };
}

export async function getSpaceSdkExtensionDiagnostics(
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<SpaceSdkExtensionDiagnostics | undefined> {
  const sdk = await getSdk(deps);
  return sdk.getActiveExtensionRuntime()?.getDiagnostics();
}

export async function createSpaceSdkExtensionRuntime(
  options: CreateSpaceSdkExtensionRuntimeOptions,
  deps?: SpaceSdkExtensionRuntimeDeps,
): Promise<SpaceSdkExtensionRuntimeHandle | undefined> {
  const servers = await loadConfiguredMcpServers(options.projectRoot, deps);
  const mcpEnabled = hasEnabledMcpServers(servers);
  const loadFilesystemExtensions = sdkExtensionsEnabledByEnv(deps?.env);

  if (!mcpEnabled && !loadFilesystemExtensions) {
    return undefined;
  }

  const sdk = await getSdk(deps);
  const runtime = sdk.createExtensionRuntime({ config: { host: 'kodax-space' } });
  let mcpProviderRegistered = false;

  try {
    if (mcpEnabled) {
      const provider = await sdk.registerConfiguredMcpCapabilityProvider(runtime, servers, {
        reverse: sdk.buildMcpReverseCapabilities({
          cwd: options.projectRoot,
          enableElicitation: options.enableElicitation ?? true,
        }),
      });
      mcpProviderRegistered = provider !== undefined;
    }

    let discovery: SpaceSdkExtensionDiscovery | undefined;
    if (loadFilesystemExtensions) {
      discovery = await discoverSpaceSdkExtensions(deps);
      await runtime.loadExtensions([...discovery.paths], {
        continueOnError: true,
        loadSource: 'discovery',
      });
    }

    runtime.activate();
    if (options.setActive === true) {
      await replaceActiveSpaceRuntime(sdk, runtime);
    }
    return {
      runtime,
      discovery,
      diagnostics: runtime.getDiagnostics(),
      mcpProviderRegistered,
    };
  } catch (err) {
    await disposeRuntimeOnce(runtime, 'failed initialization');
    throw err;
  }
}

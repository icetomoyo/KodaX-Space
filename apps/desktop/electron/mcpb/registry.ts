// .mcpb / .dxt extension registry.
//
// Canonical storage is under ~/.kodax/mcpb because an installed bundle is an
// MCP server asset shared by KodaX CLI / REPL / Space, not Space UI state.
// Older Space builds used ~/.kodax-space; startup and first registry access
// migrate that location best-effort.
import { promises as fsp } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { McpbExtensionT } from '@kodax-space/space-ipc-schema';
import { getKodaxDir } from '../kodax/data-paths.js';
import { replaceFileWithoutFollowingAliases } from '../kodax/atomic-file.js';
import type { ManifestT } from './manifest.js';

export interface McpbStoragePaths {
  home: string;
  registryPath: string;
  extractBase: string;
  tmpBase: string;
  legacyHome: string;
  legacyRegistryPath: string;
  legacyExtractBase: string;
  legacyTmpBase: string;
}

export function getMcpbStoragePaths(
  kodaxDir: string = getKodaxDir(),
  homeDir: string = os.homedir(),
): McpbStoragePaths {
  const home = path.join(kodaxDir, 'mcpb');
  const legacyHome = process.env.KODAX_TEST_ONBOARDING
    ? path.join(kodaxDir, 'legacy-kodax-space')
    : path.join(homeDir, '.kodax-space');
  return {
    home,
    registryPath: path.join(home, 'registry.json'),
    extractBase: path.join(home, 'extensions'),
    tmpBase: path.join(home, 'tmp'),
    legacyHome,
    legacyRegistryPath: path.join(legacyHome, 'mcpb-extensions.json'),
    legacyExtractBase: path.join(legacyHome, 'mcpb'),
    legacyTmpBase: path.join(legacyHome, 'tmp'),
  };
}

export interface InternalMcpbEntry extends McpbExtensionT {
  installDir: string;
  server: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface RegistryFile {
  version: 1;
  extensions: InternalMcpbEntry[];
}

const EMPTY: RegistryFile = { version: 1, extensions: [] };

const entrySchema = z.object({
  extensionId: z.string().min(1).max(256),
  name: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z.+-]+$/),
  description: z.string().max(280).optional(),
  author: z.string().max(128).optional(),
  transport: z.enum(['stdio', 'http']),
  toolCount: z.number().int().min(0).max(1024),
  installedAt: z.number().int().min(0),
  installDir: z
    .string()
    .min(1)
    .max(4096)
    .refine((v) => path.isAbsolute(v), 'installDir must be absolute'),
  server: z
    .object({
      command: z.string().min(1).max(64),
      args: z.array(z.string()).max(64).optional(),
      env: z.record(z.string()).optional(),
    })
    .strict(),
});

type RegistryLoadResult =
  | { kind: 'ok'; file: RegistryFile; dropped: number }
  | { kind: 'missing' }
  | { kind: 'invalid'; message: string };

export type McpbMigrationResult =
  | { kind: 'not-found' }
  | { kind: 'already-migrated' }
  | {
      kind: 'migrated';
      migrated: number;
      skippedExisting: number;
      registered: number;
      skippedRegistration: number;
      skippedMissingInstallDir: number;
      droppedInvalid: number;
      legacyCleanup: 'removed' | 'kept-unknown' | 'kept-error';
    }
  | {
      kind: 'cleaned-empty-legacy';
      legacyCleanup: 'removed' | 'kept-unknown' | 'kept-error';
    }
  | { kind: 'error'; message: string };

export type KodaxMcpServerConfig = {
  type?: 'stdio' | 'sse' | 'streamable-http' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  connect?: 'lazy' | 'prewarm' | 'disabled';
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  auth?: unknown;
};

export interface McpbKodaxMcpSyncDeps {
  getMcpServerConfig(name: string): KodaxMcpServerConfig | undefined;
  upsertMcpServer(name: string, config: KodaxMcpServerConfig): KodaxMcpServerConfig;
  removeMcpServer(name: string): boolean;
}

export type SyncEntryResult =
  | { kind: 'registered' }
  | { kind: 'already-current' }
  | { kind: 'skipped-existing' }
  | { kind: 'error'; message: string };

export type RemoveEntryResult =
  | { kind: 'removed' }
  | { kind: 'not-found' }
  | { kind: 'skipped-changed' }
  | { kind: 'error'; message: string };

function normalizeForPrefix(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsideBase(base: string, p: string): boolean {
  const resolved = normalizeForPrefix(p);
  const resolvedBase = normalizeForPrefix(base);
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  return resolved === resolvedBase || resolved.startsWith(baseWithSep);
}

export function getExtractBase(): string {
  return getMcpbStoragePaths().extractBase;
}

export function getTmpBase(): string {
  return getMcpbStoragePaths().tmpBase;
}

export function getRegistryPath(): string {
  return getMcpbStoragePaths().registryPath;
}

export function isInsideExtractBase(p: string): boolean {
  return isInsideBase(getExtractBase(), p);
}

async function ensureStorageDirs(paths = getMcpbStoragePaths()): Promise<void> {
  await fsp.mkdir(paths.home, { recursive: true, mode: 0o700 });
  await fsp.mkdir(paths.extractBase, { recursive: true, mode: 0o700 });
  await fsp.mkdir(paths.tmpBase, { recursive: true, mode: 0o700 });
}

async function copyDirectoryAtomic(
  sourceDir: string,
  targetDir: string,
  paths: McpbStoragePaths,
): Promise<void> {
  if (!isInsideBase(paths.extractBase, targetDir)) {
    throw new Error('migration target outside extract base');
  }
  await fsp.mkdir(paths.tmpBase, { recursive: true, mode: 0o700 });
  const safeName = path.basename(targetDir).replace(/[^A-Za-z0-9._-]/g, '_');
  const tmpDir = path.join(
    paths.tmpBase,
    `migrate-${safeName}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`,
  );
  try {
    await fsp.cp(sourceDir, tmpDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    await fsp.mkdir(path.dirname(targetDir), { recursive: true, mode: 0o700 });
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.rename(tmpDir, targetDir);
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}
async function loadRegistryFile(
  registryPath: string,
  extractBase: string,
  warnPrefix: string,
): Promise<RegistryLoadResult> {
  let buf: string;
  try {
    buf = await fsp.readFile(registryPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' };
    return {
      kind: 'invalid',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(buf);
  } catch (err) {
    return {
      kind: 'invalid',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!json || typeof json !== 'object' || (json as { version?: unknown }).version !== 1) {
    return { kind: 'invalid', message: 'top-level registry version must be 1' };
  }
  const rawExt = (json as { extensions?: unknown }).extensions;
  if (!Array.isArray(rawExt)) {
    return { kind: 'invalid', message: 'extensions must be an array' };
  }

  const validated: InternalMcpbEntry[] = [];
  let dropped = 0;
  for (const item of rawExt) {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      const issue = parsed.error.issues[0];
      const namePart =
        typeof item === 'object' && item !== null && 'name' in item
          ? String((item as { name: unknown }).name).slice(0, 64)
          : 'unknown';
      console.warn(
        `${warnPrefix} dropped invalid entry "${namePart}" at ${issue?.path.join('.') ?? '<root>'}: ${issue?.message ?? 'schema failed'}`,
      );
      continue;
    }
    if (!isInsideBase(extractBase, parsed.data.installDir)) {
      dropped++;
      console.warn(`${warnPrefix} dropped entry "${parsed.data.name}": installDir outside base`);
      continue;
    }
    validated.push(parsed.data as InternalMcpbEntry);
  }
  return { kind: 'ok', file: { version: 1, extensions: validated }, dropped };
}

async function writeRegistryFile(file: RegistryFile, paths = getMcpbStoragePaths()): Promise<void> {
  await ensureStorageDirs(paths);
  await replaceFileWithoutFollowingAliases(
    paths.registryPath,
    Buffer.from(JSON.stringify(file, null, 2), 'utf8'),
    'MCPB registry changed during atomic replacement',
  );
}

let migrationPromise: Promise<McpbMigrationResult> | null = null;

export async function migrateLegacyMcpbStorage(
  opts: {
    legacyHome?: string;
    kodaxDir?: string;
    syncDeps?: McpbKodaxMcpSyncDeps;
  } = {},
): Promise<McpbMigrationResult> {
  if (!opts.legacyHome && !opts.kodaxDir && !opts.syncDeps && migrationPromise !== null) {
    return migrationPromise;
  }
  const run = migrateLegacyMcpbStorageOnce(opts);
  if (!opts.legacyHome && !opts.kodaxDir && !opts.syncDeps) {
    migrationPromise = run;
  }
  return run;
}

async function migrateLegacyMcpbStorageOnce(opts: {
  legacyHome?: string;
  kodaxDir?: string;
  syncDeps?: McpbKodaxMcpSyncDeps;
}): Promise<McpbMigrationResult> {
  const defaultPaths = getMcpbStoragePaths(opts.kodaxDir);
  const paths = opts.legacyHome
    ? {
        ...defaultPaths,
        legacyHome: opts.legacyHome,
        legacyRegistryPath: path.join(opts.legacyHome, 'mcpb-extensions.json'),
        legacyExtractBase: path.join(opts.legacyHome, 'mcpb'),
        legacyTmpBase: path.join(opts.legacyHome, 'tmp'),
      }
    : defaultPaths;

  try {
    const legacyStat = await fsp.stat(paths.legacyHome).catch(() => null);
    if (!legacyStat || !legacyStat.isDirectory()) return { kind: 'not-found' };

    const legacyLoaded = await loadRegistryFile(
      paths.legacyRegistryPath,
      paths.legacyExtractBase,
      '[mcpb-migrate]',
    );
    if (legacyLoaded.kind === 'missing') {
      const cleanup = await cleanupLegacyKnownEntries(paths, { onlyIfKnownEmpty: true });
      return cleanup === 'removed'
        ? { kind: 'cleaned-empty-legacy', legacyCleanup: cleanup }
        : { kind: 'not-found' };
    }
    if (legacyLoaded.kind === 'invalid') {
      return { kind: 'error', message: `legacy registry invalid: ${legacyLoaded.message}` };
    }

    const currentLoaded = await loadRegistryFile(
      paths.registryPath,
      paths.extractBase,
      '[mcpb-registry]',
    );
    const current = currentLoaded.kind === 'ok' ? currentLoaded.file : EMPTY;
    const currentByName = new Map(current.extensions.map((e) => [e.name, e]));
    const existingNames = new Set(currentByName.keys());
    const nextExtensions = current.extensions.slice();
    const entriesToSync: InternalMcpbEntry[] = [];

    let migrated = 0;
    let skippedExisting = 0;
    let registered = 0;
    let skippedRegistration = 0;
    let skippedMissingInstallDir = 0;

    for (const legacyEntry of legacyLoaded.file.extensions) {
      if (existingNames.has(legacyEntry.name)) {
        const currentEntry = currentByName.get(legacyEntry.name);
        if (currentEntry) entriesToSync.push(currentEntry);
        skippedExisting++;
        continue;
      }
      const mapped = mapLegacyEntry(legacyEntry, paths);
      const oldExists = await fsp
        .stat(legacyEntry.installDir)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (!oldExists) {
        skippedMissingInstallDir++;
        continue;
      }
      await copyDirectoryAtomic(legacyEntry.installDir, mapped.installDir, paths);
      nextExtensions.push(mapped);
      existingNames.add(mapped.name);
      migrated++;
      entriesToSync.push(mapped);
    }

    if (migrated > 0) {
      await writeRegistryFile({ version: 1, extensions: nextExtensions }, paths);
    }

    let registrationErrors = 0;
    for (const entryToSync of entriesToSync) {
      const syncResult = await syncEntryToKodaxMcp(entryToSync, {
        overwrite: false,
        deps: opts.syncDeps,
      });
      if (syncResult.kind === 'registered' || syncResult.kind === 'already-current') {
        registered++;
      } else {
        skippedRegistration++;
        if (syncResult.kind === 'error') registrationErrors++;
      }
    }

    const canRemoveLegacy =
      legacyLoaded.dropped === 0 && skippedMissingInstallDir === 0 && registrationErrors === 0;
    const legacyCleanup = canRemoveLegacy
      ? await cleanupLegacyKnownEntries(paths)
      : await cleanupLegacyKnownEntries(paths, { onlyIfKnownEmpty: true });

    if (
      migrated === 0 &&
      skippedExisting > 0 &&
      skippedMissingInstallDir === 0 &&
      legacyLoaded.dropped === 0 &&
      registrationErrors === 0
    ) {
      return { kind: 'already-migrated' };
    }

    return {
      kind: 'migrated',
      migrated,
      skippedExisting,
      registered,
      skippedRegistration,
      skippedMissingInstallDir,
      droppedInvalid: legacyLoaded.dropped,
      legacyCleanup,
    };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function mapLegacyEntry(entry: InternalMcpbEntry, paths: McpbStoragePaths): InternalMcpbEntry {
  const installRel = path.relative(paths.legacyExtractBase, entry.installDir);
  const installDir = path.join(paths.extractBase, installRel);
  const args = entry.server.args?.map((arg) =>
    rewriteLegacyPath(arg, paths.legacyExtractBase, paths.extractBase),
  );
  const env = entry.server.env
    ? Object.fromEntries(
        Object.entries(entry.server.env).map(([key, value]) => [
          key,
          rewriteLegacyPath(value, paths.legacyExtractBase, paths.extractBase),
        ]),
      )
    : undefined;
  return {
    ...entry,
    installDir,
    server: {
      command: entry.server.command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

function rewriteLegacyPath(value: string, legacyBase: string, nextBase: string): string {
  if (!path.isAbsolute(value) || !isInsideBase(legacyBase, value)) return value;
  return path.join(nextBase, path.relative(legacyBase, value));
}

async function cleanupLegacyKnownEntries(
  paths: McpbStoragePaths,
  opts: { onlyIfKnownEmpty?: boolean } = {},
): Promise<'removed' | 'kept-unknown' | 'kept-error'> {
  const entries = await fsp.readdir(paths.legacyHome).catch(() => null);
  if (entries === null) return 'kept-error';
  const known = new Set(['mcpb-extensions.json', 'mcpb', 'tmp']);
  const unknown = entries.filter((e) => !known.has(e));
  if (unknown.length > 0) return 'kept-unknown';

  if (opts.onlyIfKnownEmpty) {
    const knownEntries = entries.filter((e) => known.has(e));
    for (const entry of knownEntries) {
      const full = path.join(paths.legacyHome, entry);
      const stat = await fsp.stat(full).catch(() => null);
      if (entry === 'mcpb-extensions.json' && stat?.isFile()) return 'kept-error';
      if (stat?.isDirectory()) {
        const nested = await fsp.readdir(full).catch(() => ['<error>']);
        if (nested.length > 0) return 'kept-error';
      }
    }
  }

  await fsp.rm(paths.legacyHome, { recursive: true, force: true }).catch(() => undefined);
  const exists = await fsp
    .stat(paths.legacyHome)
    .then(() => true)
    .catch(() => false);
  return exists ? 'kept-error' : 'removed';
}

export async function readRegistry(): Promise<RegistryFile> {
  await migrateLegacyMcpbStorage();
  const paths = getMcpbStoragePaths();
  const loaded = await loadRegistryFile(paths.registryPath, paths.extractBase, '[mcpb-registry]');
  if (loaded.kind === 'ok') return loaded.file;
  if (loaded.kind === 'invalid') {
    console.warn(`[mcpb-registry] read failed, starting empty: ${loaded.message}`);
  }
  return EMPTY;
}

let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

export function buildExtensionFromManifest(
  manifest: ManifestT,
  installDir: string,
): InternalMcpbEntry {
  const cfg = manifest.server.mcp_config;
  const env: Record<string, string> = {};
  if (cfg.env) {
    for (const [k, v] of Object.entries(cfg.env)) {
      env[k] = String(v);
    }
  }
  const argsOut: string[] = [];
  if (manifest.server.entry_point) {
    argsOut.push(path.join(installDir, manifest.server.entry_point));
  }
  if (cfg.args) {
    argsOut.push(...cfg.args);
  }
  return {
    extensionId: `${manifest.name}@${manifest.version}`,
    name: manifest.name,
    displayName: manifest.display_name ?? manifest.name,
    version: manifest.version,
    description: manifest.description?.slice(0, 280),
    author: manifest.author?.name?.slice(0, 128),
    transport: 'stdio',
    toolCount: manifest.tools?.length ?? 0,
    installedAt: Date.now(),
    installDir,
    server: {
      command: cfg.command,
      ...(argsOut.length > 0 ? { args: argsOut } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

export async function addOrReplace(entry: InternalMcpbEntry): Promise<{
  registry: RegistryFile;
  displacedInstallDir?: string;
  displacedEntry?: InternalMcpbEntry;
}> {
  return withWriteLock(async () => {
    const file = await readRegistry();
    const displaced = file.extensions.find((e) => e.name === entry.name);
    const next: RegistryFile = {
      version: 1,
      extensions: [...file.extensions.filter((e) => e.name !== entry.name), entry],
    };
    await writeRegistryFile(next);
    return {
      registry: next,
      ...(displaced && displaced.installDir !== entry.installDir
        ? { displacedInstallDir: displaced.installDir }
        : {}),
      ...(displaced ? { displacedEntry: displaced } : {}),
    };
  });
}

export async function removeByExtensionId(extensionId: string): Promise<{
  removed: boolean;
  registry: RegistryFile;
  installDir?: string;
  entry?: InternalMcpbEntry;
}> {
  return withWriteLock(async () => {
    const file = await readRegistry();
    const victim = file.extensions.find((e) => e.extensionId === extensionId);
    if (!victim) return { removed: false, registry: file };
    const next: RegistryFile = {
      version: 1,
      extensions: file.extensions.filter((e) => e.extensionId !== extensionId),
    };
    await writeRegistryFile(next);
    return { removed: true, registry: next, installDir: victim.installDir, entry: victim };
  });
}

export function toKodaxMcpServerConfig(entry: InternalMcpbEntry): KodaxMcpServerConfig {
  return {
    type: 'stdio',
    command: entry.server.command,
    ...(entry.server.args ? { args: entry.server.args.slice() } : {}),
    ...(entry.server.env ? { env: { ...entry.server.env } } : {}),
  };
}

export async function syncEntryToKodaxMcp(
  entry: InternalMcpbEntry,
  opts: { overwrite: boolean; deps?: McpbKodaxMcpSyncDeps },
): Promise<SyncEntryResult> {
  try {
    const deps = opts.deps ?? (await loadDefaultSyncDeps());
    const next = toKodaxMcpServerConfig(entry);
    const current = deps.getMcpServerConfig(entry.name);
    if (current && mcpConfigMatchesEntry(current, entry)) {
      return { kind: 'already-current' };
    }
    if (current && !opts.overwrite) {
      return { kind: 'skipped-existing' };
    }
    deps.upsertMcpServer(entry.name, next);
    return { kind: 'registered' };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeEntryFromKodaxMcp(
  entry: InternalMcpbEntry,
  deps?: McpbKodaxMcpSyncDeps,
): Promise<RemoveEntryResult> {
  try {
    const syncDeps = deps ?? (await loadDefaultSyncDeps());
    const current = syncDeps.getMcpServerConfig(entry.name);
    if (!current) return { kind: 'not-found' };
    if (!mcpConfigMatchesEntry(current, entry)) return { kind: 'skipped-changed' };
    return syncDeps.removeMcpServer(entry.name) ? { kind: 'removed' } : { kind: 'not-found' };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

async function loadDefaultSyncDeps(): Promise<McpbKodaxMcpSyncDeps> {
  const repl = await import('@kodax-ai/kodax/repl');
  return {
    getMcpServerConfig: repl.getMcpServerConfig,
    upsertMcpServer: repl.upsertMcpServer,
    removeMcpServer: repl.removeMcpServer,
  };
}

export function mcpConfigMatchesEntry(
  config: KodaxMcpServerConfig,
  entry: InternalMcpbEntry,
): boolean {
  const expected = toKodaxMcpServerConfig(entry);
  return (
    (config.type ?? 'stdio') === 'stdio' &&
    config.command === expected.command &&
    arrayEqual(config.args ?? [], expected.args ?? []) &&
    shallowRecordEqual(config.env ?? {}, expected.env ?? {}) &&
    config.cwd === undefined &&
    config.url === undefined &&
    config.headers === undefined &&
    config.connect === undefined &&
    config.startupTimeoutMs === undefined &&
    config.requestTimeoutMs === undefined &&
    config.auth === undefined
  );
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function shallowRecordEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (!arrayEqual(aKeys, bKeys)) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function toExternal(entry: InternalMcpbEntry): McpbExtensionT {
  return {
    extensionId: entry.extensionId,
    name: entry.name,
    displayName: entry.displayName,
    version: entry.version,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.author ? { author: entry.author } : {}),
    transport: entry.transport,
    toolCount: entry.toolCount,
    installedAt: entry.installedAt,
  };
}

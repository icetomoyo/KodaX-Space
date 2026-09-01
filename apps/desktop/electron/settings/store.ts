// SettingsStore — alpha.1
//
// Space-level user settings 持久化在 ~/.kodax/space/settings.json。与 projectStore
// 兄弟文件，同 JSON 原子写模式（write tmp + rename）。
//
// 当前仅一项：defaultWorkspace —— 用户的"workspace home"，
// 类似 IDE 默认工作目录。新 session 不再要求显式选 folder：
//   - 用户首次启动 → store 给 fallback ~/kodax_workspace + 自动 mkdir -p
//   - 用户改默认 → 通过 Settings UI 写回这里
//
// 这里**只**写标量配置 — secrets / API keys 走 keychain，永远不进 settings.json。

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  coderRuntimeModeSchema,
  reasoningModeSchema,
  terminalShellPreferenceSchema,
  windowCloseBehaviorSchema,
  type CoderRuntimeModeT,
  type SpaceRuntimeDefaultsT,
  type TerminalShellPreferenceT,
  type WindowCloseBehaviorT,
} from '@kodax-space/space-ipc-schema';
import {
  replaceFileIfUnchanged,
  replaceFileWithoutFollowingAliases,
  writeNewFileExclusive,
} from '../kodax/atomic-file.js';

const execFileAsync = promisify(execFile);

const persistedAgentModeSchema = z.preprocess(
  (value) => (value === 'amaw' || value === 'ama-workflow' ? 'ama' : value),
  z.enum(['ama', 'sa']),
);

// OC-12 测试模式 (KODAX_TEST_ONBOARDING) 下重定向到 tmpdir/kodax-test-<id>/space
import { getSpaceDataDir } from '../kodax/data-paths.js';
const SPACE_DATA_DIR = getSpaceDataDir();
const SETTINGS_FILE = path.join(SPACE_DATA_DIR, 'settings.json');
const MAX_SETTINGS_MIGRATION_BYTES = 1024 * 1024;

const runtimeDefaultFieldSchemas = {
  permissionMode: z.enum(['plan', 'accept-edits', 'auto', 'full-access']).optional(),
  /** Legacy input accepted only so normalizeRawSettings can remove it. */
  autoModeEngine: z.enum(['llm', 'rules']).optional(),
  reasoningMode: reasoningModeSchema.optional(),
  agentMode: persistedAgentModeSchema.optional(),
} as const;

const fileV1Schema = z.object({
  version: z.literal(1),
  defaultWorkspace: z.string().min(1).max(4096),
  languageMode: z.enum(['system', 'zh-CN', 'en-US']).default('system'),
});

const fileV2LooseSchema = z.object({
  version: z.literal(2),
  defaultWorkspace: z.string().min(1).max(4096),
  languageMode: z.enum(['system', 'zh-CN', 'en-US']).default('system'),
  terminalShell: terminalShellPreferenceSchema.catch('auto').default('auto'),
  windowCloseBehavior: windowCloseBehaviorSchema.catch('ask').default('ask'),
  runtimeDefaults: z.unknown().optional(),
});

const fileV3LooseSchema = fileV2LooseSchema.extend({
  version: z.literal(3),
  coderRuntimeMode: coderRuntimeModeSchema.catch('daemon').default('daemon'),
});

export interface SpaceSettings {
  readonly version: 3;
  readonly defaultWorkspace: string;
  readonly languageMode: 'system' | 'zh-CN' | 'en-US';
  readonly terminalShell: TerminalShellPreferenceT;
  readonly windowCloseBehavior: WindowCloseBehaviorT;
  readonly coderRuntimeMode: CoderRuntimeModeT;
  readonly runtimeDefaults: SpaceRuntimeDefaultsT;
}

const DEFAULT_WORKSPACE = path.join(os.homedir(), 'kodax_workspace');

function defaultCoderRuntimeMode(runtimeHostEnvironment: string | undefined): CoderRuntimeModeT {
  return runtimeHostEnvironment?.trim().toLowerCase() === 'legacy' ? 'embedded' : 'daemon';
}

function normalizeSettings(
  raw: unknown,
  runtimeHostEnvironment: string | undefined,
): SpaceSettings | null {
  const v3 = fileV3LooseSchema.safeParse(raw);
  if (v3.success) {
    return {
      version: 3,
      defaultWorkspace: v3.data.defaultWorkspace,
      languageMode: v3.data.languageMode,
      terminalShell: v3.data.terminalShell,
      windowCloseBehavior: v3.data.windowCloseBehavior,
      coderRuntimeMode: v3.data.coderRuntimeMode,
      runtimeDefaults: cleanRuntimeDefaults(v3.data.runtimeDefaults),
    };
  }

  const v2 = fileV2LooseSchema.safeParse(raw);
  if (v2.success) {
    return {
      version: 3,
      defaultWorkspace: v2.data.defaultWorkspace,
      languageMode: v2.data.languageMode,
      terminalShell: v2.data.terminalShell,
      windowCloseBehavior: v2.data.windowCloseBehavior,
      coderRuntimeMode: defaultCoderRuntimeMode(runtimeHostEnvironment),
      runtimeDefaults: cleanRuntimeDefaults(v2.data.runtimeDefaults),
    };
  }

  const v1 = fileV1Schema.safeParse(raw);
  if (v1.success) {
    return {
      version: 3,
      defaultWorkspace: v1.data.defaultWorkspace,
      languageMode: v1.data.languageMode,
      terminalShell: 'auto',
      windowCloseBehavior: 'ask',
      coderRuntimeMode: defaultCoderRuntimeMode(runtimeHostEnvironment),
      runtimeDefaults: {},
    };
  }

  return null;
}

function hasRetiredAgentMode(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const runtimeDefaults = (raw as Record<string, unknown>).runtimeDefaults;
  if (!runtimeDefaults || typeof runtimeDefaults !== 'object' || Array.isArray(runtimeDefaults)) {
    return false;
  }
  const agentMode = (runtimeDefaults as Record<string, unknown>).agentMode;
  return agentMode === 'amaw' || agentMode === 'ama-workflow';
}

function hasPreV3Schema(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const version = (raw as Record<string, unknown>).version;
  return version === 1 || version === 2;
}

function migrateRetiredAgentMode(raw: unknown): unknown {
  if (!hasRetiredAgentMode(raw)) return raw;
  const settings = raw as Record<string, unknown>;
  const runtimeDefaults = settings.runtimeDefaults as Record<string, unknown>;
  return {
    ...settings,
    runtimeDefaults: { ...runtimeDefaults, agentMode: 'ama' },
  };
}

function migratePreV3Settings(raw: unknown, normalized: SpaceSettings): unknown {
  const rawSettings =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawRuntimeDefaults =
    rawSettings.runtimeDefaults &&
    typeof rawSettings.runtimeDefaults === 'object' &&
    !Array.isArray(rawSettings.runtimeDefaults)
      ? (rawSettings.runtimeDefaults as Record<string, unknown>)
      : {};
  const runtimeDefaults: Record<string, unknown> = { ...rawRuntimeDefaults };
  for (const key of Object.keys(runtimeDefaultFieldSchemas)) {
    delete runtimeDefaults[key];
  }
  Object.assign(runtimeDefaults, normalized.runtimeDefaults);
  return {
    ...rawSettings,
    ...normalized,
    runtimeDefaults,
  };
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function cleanRuntimeDefaults(defaults: unknown): SpaceRuntimeDefaultsT {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return {};
  const raw = defaults as Record<string, unknown>;
  const cleaned: SpaceRuntimeDefaultsT = {};

  if (raw.permissionMode !== undefined) {
    const parsed = runtimeDefaultFieldSchemas.permissionMode.safeParse(raw.permissionMode);
    if (parsed.success) cleaned.permissionMode = parsed.data;
  }
  if (raw.reasoningMode !== undefined) {
    const parsed = runtimeDefaultFieldSchemas.reasoningMode.safeParse(raw.reasoningMode);
    if (parsed.success) cleaned.reasoningMode = parsed.data;
  }
  if (raw.agentMode !== undefined) {
    const parsed = runtimeDefaultFieldSchemas.agentMode.safeParse(raw.agentMode);
    if (parsed.success) cleaned.agentMode = parsed.data;
  }

  return cleaned;
}

export class SettingsStore {
  private cached: SpaceSettings | null = null;
  private loadPromise: Promise<SpaceSettings> | null = null;
  private writeLock: Promise<SpaceSettings | void> = Promise.resolve();

  constructor(
    private readonly filePath: string = SETTINGS_FILE,
    private readonly dir: string = SPACE_DATA_DIR,
    private readonly runtimeHostEnvironment: string | undefined = process.env
      .KODAX_SPACE_RUNTIME_HOST,
  ) {}

  async load(): Promise<SpaceSettings> {
    if (this.cached) return { ...this.cached, runtimeDefaults: { ...this.cached.runtimeDefaults } };
    const inFlight = this.loadPromise ?? this.loadUncached();
    this.loadPromise = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.loadPromise === inFlight) this.loadPromise = null;
    }
  }

  private async loadUncached(): Promise<SpaceSettings> {
    let settingsFileMissing = false;
    try {
      const raw = await fs.readFile(this.filePath);
      const decoded = JSON.parse(raw.toString('utf-8')) as unknown;
      const parsed = normalizeSettings(decoded, this.runtimeHostEnvironment);
      if (parsed) {
        this.cached = parsed;
        if (hasPreV3Schema(decoded) || hasRetiredAgentMode(decoded)) {
          // Persist schema upgrades and retired modes exactly once. Replace only
          // the exact bytes read above, so a concurrent Space instance cannot
          // lose newer settings. Failure is non-fatal; a later launch retries.
          try {
            await this.migrateSettings(decoded, parsed, raw);
          } catch (err) {
            console.warn(
              `[SettingsStore] settings migration failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return { ...this.cached, runtimeDefaults: { ...this.cached.runtimeDefaults } };
      }
      console.warn(`[SettingsStore] ${this.filePath} schema invalid, falling back to defaults`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        settingsFileMissing = true;
      } else {
        console.warn(`[SettingsStore] read failed (${e.code}), falling back to defaults`);
      }
    }
    // Fallback
    const defaults: SpaceSettings = {
      version: 3,
      defaultWorkspace: DEFAULT_WORKSPACE,
      languageMode: 'system',
      terminalShell: 'auto',
      windowCloseBehavior: 'ask',
      coderRuntimeMode: defaultCoderRuntimeMode(this.runtimeHostEnvironment),
      runtimeDefaults: {},
    };
    // Do not expose the in-memory default until its exclusive create settles.
    // A concurrent setter must first observe whichever complete document won
    // the create race instead of updating against an unpublished default.
    this.cached = settingsFileMissing ? await this.persistInitialSettings(defaults) : defaults;
    return { ...this.cached, runtimeDefaults: { ...this.cached.runtimeDefaults } };
  }

  /**
   * 确保 defaultWorkspace 目录存在 — main 启动期一次，让 renderer 直接拿来用。
   * 用户改默认目录后也要再调一次以创建新目录（用户可能输了不存在的路径）。
   *
   * 也确保它是个 git repo —— KodaX SDK 的 FileSessionStorage 按 gitRoot 索引
   * persistent session；workspace 不是 git repo 时 SDK 的 session 落盘 / list
   * 路径会拿不到稳定的 gitRoot，导致重启后 session 列表显示空。git init 是 idempotent
   * 操作，已是 git repo 时不重复初始化。Claude Code 在自家 workspace 也采用同样策略。
   */
  async ensureWorkspaceExists(): Promise<void> {
    const s = await this.load();
    try {
      await fs.mkdir(s.defaultWorkspace, { recursive: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      console.warn(
        `[SettingsStore] mkdir defaultWorkspace="${s.defaultWorkspace}" failed (${e.code}): ${e.message}`,
      );
      return; // 没目录就别试 git init
    }
    await this.ensureGitRepo(s.defaultWorkspace);
  }

  /**
   * 若目标目录还不是 git repo，跑 `git init`。已是 git repo（含 .git 目录或父级
   * 已是 git）时静默跳过。git 命令不存在 / 调用失败也只 log warn 不抛 —— session
   * 持久化是 nice-to-have，不该阻塞 app 启动。
   */
  private async ensureGitRepo(absDir: string): Promise<void> {
    try {
      await fs.access(path.join(absDir, '.git'));
      return; // 已是 git repo
    } catch {
      /* fallthrough — 需要 init */
    }
    try {
      // -q 抑制 stdout；只在 absDir 当前层级初始化（不继承父级 git）
      await execFileAsync('git', ['init', '-q'], { cwd: absDir, timeout: 5_000 });
      console.info(`[SettingsStore] git init at ${absDir}`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      console.warn(
        `[SettingsStore] git init at "${absDir}" failed (${e.code ?? 'unknown'}): ` +
          `${e.message}. Session persistence may be unreliable until this is a git repo.`,
      );
    }
  }

  async setDefaultWorkspace(absPath: string): Promise<SpaceSettings> {
    return this.update((current) => ({ ...current, defaultWorkspace: absPath }));
  }

  async setLanguageMode(languageMode: SpaceSettings['languageMode']): Promise<SpaceSettings> {
    return this.update((current) => ({ ...current, languageMode }));
  }

  async setTerminalShell(terminalShell: TerminalShellPreferenceT): Promise<SpaceSettings> {
    return this.update((current) => ({ ...current, terminalShell }));
  }

  async setWindowCloseBehavior(windowCloseBehavior: WindowCloseBehaviorT): Promise<SpaceSettings> {
    return this.update((current) => ({ ...current, windowCloseBehavior }));
  }

  async setCoderRuntimeMode(coderRuntimeMode: CoderRuntimeModeT): Promise<SpaceSettings> {
    return this.update((current) => ({ ...current, coderRuntimeMode }));
  }

  async setRuntimeDefaults(
    runtimeDefaults: Partial<SpaceRuntimeDefaultsT>,
  ): Promise<SpaceSettings> {
    return this.update((current) => ({
      ...current,
      runtimeDefaults: {
        ...cleanRuntimeDefaults(current.runtimeDefaults),
        ...cleanRuntimeDefaults(runtimeDefaults),
      },
    }));
  }

  private async update(updater: (current: SpaceSettings) => SpaceSettings): Promise<SpaceSettings> {
    // Initialize the cache before entering the write queue. Each updater then
    // derives from the latest successfully committed state inside that queue,
    // so concurrent setters cannot overwrite one another.
    await this.load();

    const operation = this.writeLock
      .catch(() => undefined)
      .then(async () => {
        const current = this.cached;
        if (!current) throw new Error('settings cache is unavailable');
        const next = updater({
          ...current,
          runtimeDefaults: { ...current.runtimeDefaults },
        });

        await fs.mkdir(this.dir, { recursive: true });
        await replaceFileWithoutFollowingAliases(
          this.filePath,
          Buffer.from(JSON.stringify(next, null, 2), 'utf-8'),
          'settings changed during update',
        );

        // A failed write must not make the in-memory value look persisted.
        this.cached = next;
        return next;
      });
    this.writeLock = operation;
    const committed = await operation;
    return { ...committed, runtimeDefaults: { ...committed.runtimeDefaults } };
  }

  private async migrateSettings(
    decoded: unknown,
    normalized: SpaceSettings,
    originalBytes: Buffer,
  ): Promise<void> {
    const migrated = hasPreV3Schema(decoded)
      ? migratePreV3Settings(decoded, normalized)
      : migrateRetiredAgentMode(decoded);
    const migratedBytes = Buffer.from(JSON.stringify(migrated, null, 2), 'utf-8');
    this.writeLock = this.writeLock
      .catch(() => undefined)
      .then(async () => {
        await replaceFileIfUnchanged(
          this.filePath,
          migratedBytes,
          sha256(originalBytes),
          'settings changed during schema migration',
          MAX_SETTINGS_MIGRATION_BYTES,
        );
      });
    await this.writeLock;
  }

  private async persistInitialSettings(defaults: SpaceSettings): Promise<SpaceSettings> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await writeNewFileExclusive(
        this.filePath,
        Buffer.from(JSON.stringify(defaults, null, 2), 'utf-8'),
        'settings were created by another Space instance',
      );
      return defaults;
    } catch (error) {
      // A concurrent Space instance may have created a newer preference after
      // this load observed ENOENT. Prefer that complete document over the local
      // default and never overwrite it.
      try {
        const currentBytes = await fs.readFile(this.filePath);
        const decoded = JSON.parse(currentBytes.toString('utf-8')) as unknown;
        const current = normalizeSettings(decoded, this.runtimeHostEnvironment);
        if (current) {
          if (hasPreV3Schema(decoded) || hasRetiredAgentMode(decoded)) {
            await this.migrateSettings(decoded, current, currentBytes).catch(() => undefined);
          }
          return current;
        }
      } catch {
        // The original create error below is more useful than a secondary read.
      }
      console.warn(
        `[SettingsStore] initial settings persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return defaults;
    }
  }
}

export const settingsStore = new SettingsStore();

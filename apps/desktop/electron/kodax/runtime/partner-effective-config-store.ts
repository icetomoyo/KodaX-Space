import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  replaceFileIfUnchanged,
  replaceFileWithoutFollowingAliases,
  writeNewFileExclusive,
} from '../atomic-file.js';
import { getSpaceDataDir } from '../data-paths.js';

const MAX_CONFIG_BYTES = 32 * 1024;
const TRANSIENT_INSTALL_ALIAS_RETRIES = 4;
const reasoningModeSchema = z.enum(['off', 'auto', 'quick', 'balanced', 'deep']);
const permissionModeSchema = z.enum(['plan', 'accept-edits', 'auto']);
const autoModeEngineSchema = z.enum(['llm', 'rules']);
const agentModeSchema = z.enum(['ama', 'amaw', 'sa']);

const partnerEffectiveConfigSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    model: z.string().min(1).max(256).optional(),
    reasoningMode: reasoningModeSchema,
    permissionMode: permissionModeSchema,
    autoModeEngine: autoModeEngineSchema,
    agentMode: agentModeSchema,
    toolPolicyId: z.string().min(1).max(128),
  })
  .strict();

const partnerEffectiveConfigSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    surface: z.literal('partner'),
    profileId: z.literal('kodax-space.partner'),
    revision: z.number().int().positive(),
    updatedAt: z.number().int().nonnegative(),
    source: z.enum(['v0.1.31-migration', 'space-settings']),
    effective: partnerEffectiveConfigSchema,
  })
  .strict();

export type PartnerEffectiveConfigSeed = z.infer<typeof partnerEffectiveConfigSchema>;
export type PartnerEffectiveConfigSnapshot = z.infer<typeof partnerEffectiveConfigSnapshotSchema>;

export type PartnerEffectiveConfigLoad =
  | {
      readonly status: 'healthy' | 'seeded';
      readonly snapshot: PartnerEffectiveConfigSnapshot;
    }
  | {
      readonly status: 'recovered-read-only';
      readonly snapshot: PartnerEffectiveConfigSnapshot;
      readonly reason: string;
    };

type FileRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | {
      readonly kind: 'valid';
      readonly snapshot: PartnerEffectiveConfigSnapshot;
      readonly hash: string;
    };

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sameFile(
  before: Awaited<ReturnType<typeof fs.lstat>>,
  opened: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>>,
  after: Awaited<ReturnType<typeof fs.lstat>>,
): boolean {
  return (
    before.dev === opened.dev &&
    before.ino === opened.ino &&
    opened.dev === after.dev &&
    opened.ino === after.ino
  );
}

function freezeSnapshot(snapshot: PartnerEffectiveConfigSnapshot): PartnerEffectiveConfigSnapshot {
  const effective = Object.freeze({ ...snapshot.effective });
  return Object.freeze({ ...snapshot, effective });
}

function healthyLoad(
  snapshot: PartnerEffectiveConfigSnapshot,
  status: 'healthy' | 'seeded' = 'healthy',
): PartnerEffectiveConfigLoad {
  return Object.freeze({ status, snapshot });
}

function recoveredLoad(
  snapshot: PartnerEffectiveConfigSnapshot,
  reason: string,
): PartnerEffectiveConfigLoad {
  return Object.freeze({ status: 'recovered-read-only', snapshot, reason });
}

function encode(snapshot: PartnerEffectiveConfigSnapshot): Buffer {
  return Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Space-owned Partner configuration boundary for F121.
 *
 * This store has no Coder Runtime fields or SDK imports. A corrupt primary may
 * be inspected from the previous known-good revision, but remains read-only
 * until an explicit repair acknowledges that rollback.
 */
export class PartnerEffectiveConfigStore {
  readonly #primaryPath: string;
  readonly #lastKnownGoodPath: string;
  #state: PartnerEffectiveConfigLoad | undefined;
  #loadPromise: Promise<PartnerEffectiveConfigLoad> | undefined;
  #writeLock: Promise<void> = Promise.resolve();

  constructor(
    primaryPath = path.join(getSpaceDataDir(), 'partner-effective-config.json'),
    lastKnownGoodPath = path.join(
      getSpaceDataDir(),
      'partner-effective-config.last-known-good.json',
    ),
  ) {
    this.#primaryPath = primaryPath;
    this.#lastKnownGoodPath = lastKnownGoodPath;
  }

  loadOrSeed(seed: PartnerEffectiveConfigSeed): Promise<PartnerEffectiveConfigLoad> {
    if (this.#state) return Promise.resolve(this.#state);
    if (!this.#loadPromise) {
      const pending = this.#loadOrSeed(partnerEffectiveConfigSchema.parse(seed));
      this.#loadPromise = pending;
      void pending.catch(() => {
        if (this.#loadPromise === pending) this.#loadPromise = undefined;
      });
    }
    return this.#loadPromise;
  }

  update(
    expectedRevision: number,
    mutate: (effective: PartnerEffectiveConfigSeed) => PartnerEffectiveConfigSeed,
  ): Promise<PartnerEffectiveConfigSnapshot> {
    return this.#serialize(async () => {
      const state = this.#requireLoaded();
      if (state.status === 'recovered-read-only') {
        throw new Error('Partner effective config requires explicit repair before updates.');
      }
      const disk = await this.#read(this.#primaryPath, 'primary');
      if (disk.kind !== 'valid') {
        throw new Error('Partner effective config primary is unavailable for revision CAS.');
      }
      if (disk.snapshot.revision !== expectedRevision) {
        this.#state = healthyLoad(disk.snapshot);
        throw new Error(
          `Partner effective config revision conflict: expected ${expectedRevision}, current ${disk.snapshot.revision}.`,
        );
      }

      const effective = partnerEffectiveConfigSchema.parse(mutate({ ...disk.snapshot.effective }));
      const next = freezeSnapshot(
        partnerEffectiveConfigSnapshotSchema.parse({
          ...disk.snapshot,
          revision: disk.snapshot.revision + 1,
          updatedAt: Date.now(),
          source: 'space-settings',
          effective,
        }),
      );

      // Preserve the current committed revision before replacing the primary.
      // A failure after this point still leaves both files on the old revision.
      await this.#replace(this.#lastKnownGoodPath, disk.snapshot);
      try {
        await replaceFileIfUnchanged(
          this.#primaryPath,
          encode(next),
          disk.hash,
          'Partner effective config revision conflict.',
          MAX_CONFIG_BYTES,
        );
      } catch (error) {
        const latest = await this.#read(this.#primaryPath, 'primary').catch(() => null);
        if (latest?.kind === 'valid') this.#state = healthyLoad(latest.snapshot);
        throw new Error('Partner effective config revision conflict during commit.', {
          cause: error,
        });
      }
      this.#state = healthyLoad(next);
      return next;
    });
  }

  repairFromLastKnownGood(): Promise<PartnerEffectiveConfigSnapshot> {
    return this.#serialize(async () => {
      const state = this.#requireLoaded();
      if (state.status !== 'recovered-read-only') return state.snapshot;

      await this.#replace(this.#primaryPath, state.snapshot);
      await this.#replace(this.#lastKnownGoodPath, state.snapshot);
      this.#state = healthyLoad(state.snapshot);
      return state.snapshot;
    });
  }

  async #loadOrSeed(seed: PartnerEffectiveConfigSeed): Promise<PartnerEffectiveConfigLoad> {
    const [primary, backup] = await Promise.all([
      this.#read(this.#primaryPath, 'primary'),
      this.#read(this.#lastKnownGoodPath, 'last-known-good'),
    ]);

    if (primary.kind === 'valid') {
      if (backup.kind !== 'valid') {
        await this.#replace(this.#lastKnownGoodPath, primary.snapshot);
      }
      const loaded = healthyLoad(primary.snapshot);
      this.#state = loaded;
      return loaded;
    }

    if (backup.kind === 'valid') {
      const reason =
        primary.kind === 'absent'
          ? 'Partner effective config primary is missing; loaded last-known-good read-only.'
          : `Partner effective config primary is invalid (${primary.reason}); loaded last-known-good read-only.`;
      const recovered = recoveredLoad(backup.snapshot, reason);
      this.#state = recovered;
      return recovered;
    }

    if (primary.kind === 'invalid' || backup.kind === 'invalid') {
      throw new Error('Partner effective config is invalid and has no last-known-good recovery.');
    }

    const snapshot = freezeSnapshot(
      partnerEffectiveConfigSnapshotSchema.parse({
        schemaVersion: 1,
        surface: 'partner',
        profileId: 'kodax-space.partner',
        revision: 1,
        updatedAt: Date.now(),
        source: 'v0.1.31-migration',
        effective: seed,
      }),
    );
    await fs.mkdir(path.dirname(this.#primaryPath), { recursive: true, mode: 0o700 });
    try {
      await writeNewFileExclusive(
        this.#primaryPath,
        encode(snapshot),
        'Partner effective config was seeded concurrently.',
      );
    } catch {
      const winner = await this.#read(this.#primaryPath, 'primary');
      if (winner.kind !== 'valid') throw new Error('Concurrent Partner config seed was invalid.');
      await this.#replace(this.#lastKnownGoodPath, winner.snapshot);
      const loaded = healthyLoad(winner.snapshot);
      this.#state = loaded;
      return loaded;
    }
    await this.#replace(this.#lastKnownGoodPath, snapshot);
    const seeded = healthyLoad(snapshot, 'seeded');
    this.#state = seeded;
    return seeded;
  }

  #requireLoaded(): PartnerEffectiveConfigLoad {
    if (!this.#state) throw new Error('Partner effective config must be loaded before mutation.');
    return this.#state;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeLock.then(operation);
    this.#writeLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #replace(filePath: string, snapshot: PartnerEffectiveConfigSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await replaceFileWithoutFollowingAliases(
      filePath,
      encode(snapshot),
      'Partner effective config changed during atomic replacement.',
    );
  }

  async #read(filePath: string, label: string, aliasRetry = 0): Promise<FileRead> {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
    if (stat.nlink > 1 && aliasRetry < TRANSIENT_INSTALL_ALIAS_RETRIES) {
      // Atomic first-install briefly has two names: the private temp link and
      // the public target. The writer unlinks the temp immediately after link().
      // Retry the complete guarded read; a persistent/foreign alias still fails.
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      return this.#read(filePath, label, aliasRetry + 1);
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) {
      throw new Error(`Partner effective config ${label} must be a standalone regular file.`);
    }
    if (stat.size > MAX_CONFIG_BYTES) {
      return { kind: 'invalid', reason: `${label} exceeds the safe size limit` };
    }

    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error(`Partner effective config ${label} must not be a symbolic link.`, {
          cause: error,
        });
      }
      throw error;
    }

    try {
      const [opened, bytes] = await Promise.all([handle.stat(), handle.readFile()]);
      const after = await fs.lstat(filePath);
      if (!opened.isFile() || !sameFile(stat, opened, after) || opened.nlink > 1) {
        throw new Error(
          `Partner effective config ${label} changed or gained aliases while being read.`,
        );
      }
      if (bytes.length > MAX_CONFIG_BYTES) {
        return { kind: 'invalid', reason: `${label} exceeds the safe size limit` };
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        return { kind: 'invalid', reason: `${label} JSON parse` };
      }
      const parsed = partnerEffectiveConfigSnapshotSchema.safeParse(decoded);
      if (!parsed.success) return { kind: 'invalid', reason: `${label} schema mismatch` };
      return {
        kind: 'valid',
        snapshot: freezeSnapshot(parsed.data),
        hash: sha256(bytes),
      };
    } finally {
      await handle.close();
    }
  }
}

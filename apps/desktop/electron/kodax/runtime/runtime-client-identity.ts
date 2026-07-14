import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { replaceFileIfUnchanged, writeNewFileExclusive } from '../atomic-file.js';
import { getSpaceDataDir } from '../data-paths.js';

const MAX_IDENTITY_BYTES = 4 * 1024;
const CLIENT_ID_RE =
  /^space_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const stableRuntimeClientIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    clientId: z.string().regex(CLIENT_ID_RE),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export type StableRuntimeClientIdentity = z.infer<typeof stableRuntimeClientIdentitySchema>;

export interface RuntimeClientInstanceIdentity {
  readonly clientId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly title?: string;
  readonly version: string;
}

type IdentityReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly hash: string }
  | { readonly kind: 'valid'; readonly identity: StableRuntimeClientIdentity };

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

function identityBytes(identity: StableRuntimeClientIdentity): Buffer {
  return Buffer.from(`${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}

/**
 * Owns Space's stable daemon client identity without importing the KodaX SDK.
 *
 * The persistent clientId identifies the installed Space profile. instanceId is
 * deliberately process-local and rotates for every Runtime attachment.
 */
export class RuntimeClientIdentityStore {
  readonly #filePath: string;
  readonly #directory: string;
  readonly #uuid: () => string;
  #stablePromise: Promise<StableRuntimeClientIdentity> | undefined;

  constructor(
    filePath = path.join(getSpaceDataDir(), 'runtime-client-identity.json'),
    directory = path.dirname(filePath),
    uuid: () => string = randomUUID,
  ) {
    this.#filePath = filePath;
    this.#directory = directory;
    this.#uuid = uuid;
  }

  loadOrCreate(): Promise<StableRuntimeClientIdentity> {
    if (!this.#stablePromise) {
      const pending = this.#loadOrCreate();
      this.#stablePromise = pending;
      void pending.catch(() => {
        if (this.#stablePromise === pending) this.#stablePromise = undefined;
      });
    }
    return this.#stablePromise;
  }

  async openInstance(metadata: {
    readonly name: string;
    readonly title?: string;
    readonly version: string;
  }): Promise<RuntimeClientInstanceIdentity> {
    const stable = await this.loadOrCreate();
    return {
      clientId: stable.clientId,
      instanceId: `space_instance_${this.#uuid()}`,
      name: metadata.name,
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      version: metadata.version,
    };
  }

  async #loadOrCreate(): Promise<StableRuntimeClientIdentity> {
    await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.#read();
      if (current.kind === 'valid') return current.identity;

      const candidate: StableRuntimeClientIdentity = {
        schemaVersion: 1,
        clientId: `space_${this.#uuid()}`,
        createdAt: Date.now(),
      };
      const bytes = identityBytes(candidate);

      try {
        if (current.kind === 'absent') {
          await writeNewFileExclusive(
            this.#filePath,
            bytes,
            'Runtime client identity was created concurrently.',
          );
        } else {
          await replaceFileIfUnchanged(
            this.#filePath,
            bytes,
            current.hash,
            'Runtime client identity changed concurrently.',
            MAX_IDENTITY_BYTES,
          );
        }
      } catch {
        // Another Space process may have won the commit. Re-read the installed
        // regular file and use its identity instead of retaining our candidate.
        continue;
      }

      const installed = await this.#read();
      if (installed.kind === 'valid') return installed.identity;
    }

    throw new Error('Unable to establish a stable Runtime client identity.');
  }

  async #read(): Promise<IdentityReadResult> {
    let before: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      before = await fs.lstat(this.#filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      throw error;
    }

    if (before.isSymbolicLink()) {
      throw new Error('Runtime client identity must not be a symbolic link.');
    }
    if (!before.isFile()) {
      throw new Error('Runtime client identity must be a regular file.');
    }
    if (before.nlink > 1) {
      throw new Error('Runtime client identity must not have hard-link aliases.');
    }
    if (before.size > MAX_IDENTITY_BYTES) {
      throw new Error('Runtime client identity exceeds the safe size limit.');
    }

    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(this.#filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Runtime client identity must not be a symbolic link.', { cause: error });
      }
      throw error;
    }

    try {
      const [opened, bytes] = await Promise.all([handle.stat(), handle.readFile()]);
      const after = await fs.lstat(this.#filePath);
      if (!opened.isFile() || !sameFile(before, opened, after)) {
        throw new Error('Runtime client identity changed while it was being read.');
      }
      if (opened.nlink > 1 || bytes.length > MAX_IDENTITY_BYTES) {
        throw new Error('Runtime client identity is not a safe standalone file.');
      }

      const parsed = stableRuntimeClientIdentitySchema.safeParse(
        (() => {
          try {
            return JSON.parse(bytes.toString('utf8')) as unknown;
          } catch {
            return undefined;
          }
        })(),
      );
      if (!parsed.success) return { kind: 'invalid', hash: sha256(bytes) };
      return { kind: 'valid', identity: Object.freeze({ ...parsed.data }) };
    } finally {
      await handle.close();
    }
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { replaceFileIfUnchanged, writeNewFileExclusive } from '../atomic-file.js';
import { getSpaceDataDir } from '../data-paths.js';

const MAX_IDENTITY_BYTES = 4 * 1024;
const CLIENT_ID_RE =
  /^space_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANCE_ID_RE =
  /^space_instance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_ACCOUNT_RE =
  /^runtime_client_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const legacyRuntimeClientIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    clientId: z.string().regex(CLIENT_ID_RE),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

const v2RuntimeClientIdentitySchema = z
  .object({
    schemaVersion: z.literal(2),
    clientId: z.string().regex(CLIENT_ID_RE),
    instanceId: z.string().regex(INSTANCE_ID_RE),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

const stableRuntimeClientIdentitySchema = z
  .object({
    schemaVersion: z.literal(3),
    clientId: z.string().regex(CLIENT_ID_RE),
    instanceId: z.string().regex(INSTANCE_ID_RE),
    secretAccount: z.string().regex(SECRET_ACCOUNT_RE),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export type StableRuntimeClientIdentity = z.infer<typeof stableRuntimeClientIdentitySchema>;

export interface RuntimeClientInstanceIdentity {
  readonly clientId: string;
  readonly instanceId: string;
  readonly instanceSecret: string;
  readonly name: string;
  readonly title?: string;
  readonly version: string;
}

export interface RuntimeClientSecretStore {
  read(account: string): Promise<string | undefined>;
  write(account: string, secret: string): Promise<void>;
}

type IdentityReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly hash: string }
  | {
      readonly kind: 'legacy';
      readonly hash: string;
      readonly identity:
        | z.infer<typeof legacyRuntimeClientIdentitySchema>
        | z.infer<typeof v2RuntimeClientIdentitySchema>;
    }
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

function defaultSecretStore(): RuntimeClientSecretStore {
  return {
    async read(account) {
      const keychain = await import('../../providers/keychain.js');
      if ((await keychain.getBackendStatus()) !== 'keychain') {
        throw new Error('OS keychain is required for the Runtime client secret.');
      }
      return keychain.getKey(account);
    },
    async write(account, secret) {
      const keychain = await import('../../providers/keychain.js');
      if ((await keychain.getBackendStatus()) !== 'keychain') {
        throw new Error('OS keychain is required for the Runtime client secret.');
      }
      await keychain.setKey(account, secret);
    },
  };
}

/**
 * Owns Space's stable daemon client identity without importing the KodaX SDK.
 *
 * The persistent clientId identifies the installed Space profile. The KodaX
 * daemon contract also requires clientInfo.instanceId and a separate secret to
 * remain stable for the Space installation. The protected file stores only the
 * keychain account name; secret material never enters the Runtime data tree.
 */
export class RuntimeClientIdentityStore {
  readonly #filePath: string;
  readonly #directory: string;
  readonly #uuid: () => string;
  readonly #secretStore: RuntimeClientSecretStore;
  #stablePromise: Promise<StableRuntimeClientIdentity> | undefined;
  #secretPromise: { readonly account: string; readonly value: Promise<string> } | undefined;

  constructor(
    filePath = path.join(getSpaceDataDir(), 'runtime-client-identity.json'),
    directory = path.dirname(filePath),
    uuid: () => string = randomUUID,
    secretStore: RuntimeClientSecretStore = defaultSecretStore(),
  ) {
    this.#filePath = filePath;
    this.#directory = directory;
    this.#uuid = uuid;
    this.#secretStore = secretStore;
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
    const instanceSecret = await this.#loadSecret(stable.secretAccount);
    return {
      clientId: stable.clientId,
      instanceId: stable.instanceId,
      instanceSecret,
      name: metadata.name,
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      version: metadata.version,
    };
  }

  async #loadOrCreate(): Promise<StableRuntimeClientIdentity> {
    await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.#read();
      if (current.kind === 'valid') {
        await this.#loadSecret(current.identity.secretAccount);
        return current.identity;
      }

      const previous = current.kind === 'legacy' ? current.identity : undefined;

      const candidate: StableRuntimeClientIdentity = {
        schemaVersion: 3,
        clientId: previous !== undefined ? previous.clientId : `space_${this.#uuid()}`,
        instanceId:
          previous !== undefined && 'instanceId' in previous
            ? previous.instanceId
            : `space_instance_${this.#uuid()}`,
        secretAccount: `runtime_client_${this.#uuid()}`,
        createdAt: previous !== undefined ? previous.createdAt : Date.now(),
      };
      // Populate a candidate-specific keychain account before publishing its
      // name. Concurrent first starts therefore cannot overwrite one another's
      // secret; only the identity-file winner becomes authoritative.
      await this.#loadSecret(candidate.secretAccount);
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

  #loadSecret(account: string): Promise<string> {
    if (this.#secretPromise?.account !== account) {
      const pending = (async () => {
        const existing = await this.#secretStore.read(account);
        if (existing !== undefined) {
          if (existing.length < 32 || existing.length > 512) {
            throw new Error('Runtime client secret stored in the OS keychain is invalid.');
          }
          return existing;
        }
        const candidate = `space_secret_${this.#uuid()}`;
        await this.#secretStore.write(account, candidate);
        const installed = await this.#secretStore.read(account);
        if (installed === undefined || installed.length < 32 || installed.length > 512) {
          throw new Error('Unable to persist the Runtime client secret in the OS keychain.');
        }
        return installed;
      })();
      const entry = { account, value: pending };
      this.#secretPromise = entry;
      void pending.catch(() => {
        if (this.#secretPromise === entry) this.#secretPromise = undefined;
      });
    }
    return this.#secretPromise.value;
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

      const raw = (() => {
        try {
          return JSON.parse(bytes.toString('utf8')) as unknown;
        } catch {
          return undefined;
        }
      })();
      const parsed = stableRuntimeClientIdentitySchema.safeParse(raw);
      if (parsed.success) {
        return { kind: 'valid', identity: Object.freeze({ ...parsed.data }) };
      }
      const legacy = legacyRuntimeClientIdentitySchema.safeParse(raw);
      if (legacy.success) {
        return {
          kind: 'legacy',
          hash: sha256(bytes),
          identity: Object.freeze({ ...legacy.data }),
        };
      }
      const v2 = v2RuntimeClientIdentitySchema.safeParse(raw);
      if (v2.success) {
        return {
          kind: 'legacy',
          hash: sha256(bytes),
          identity: Object.freeze({ ...v2.data }),
        };
      }
      return { kind: 'invalid', hash: sha256(bytes) };
    } finally {
      await handle.close();
    }
  }
}

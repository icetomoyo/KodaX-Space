import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function sha256Bytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function siblingPath(filePath: string, purpose: string): string {
  return path.join(
    path.dirname(filePath),
    `.kodax-atomic-${targetKey(filePath)}-${purpose}-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
  );
}

const LOCK_POLL_MS = 10;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const INVALID_LOCK_GRACE_MS = 2_000;
const PROCESS_INSTANCE_ID = randomUUID();

interface FileTransactionLockOwner {
  readonly version: 1;
  readonly pid: number;
  readonly processInstanceId: string;
  readonly token: string;
  readonly createdAt: number;
}

export class AtomicFileTransactionError extends Error {
  override readonly name = 'AtomicFileTransactionError';
}

function targetKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  const filesystemKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return createHash('sha256').update(filesystemKey).digest('hex').slice(0, 16);
}

function transactionLockPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.kodax-atomic-${targetKey(filePath)}-lock`);
}

function transactionReaperPrefix(filePath: string): string {
  return `.kodax-atomic-${targetKey(filePath)}-reaper-`;
}

function transactionReaperPath(filePath: string, token: string): string {
  return path.join(path.dirname(filePath), `${transactionReaperPrefix(filePath)}${token}.lease`);
}

function isLockOwner(value: unknown): value is FileTransactionLockOwner {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<FileTransactionLockOwner>;
  return (
    candidate.version === 1 &&
    Number.isSafeInteger(candidate.pid) &&
    (candidate.pid ?? 0) > 0 &&
    typeof candidate.processInstanceId === 'string' &&
    candidate.processInstanceId.length > 0 &&
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    Number.isFinite(candidate.createdAt)
  );
}

async function readLockOwner(lockPath: string): Promise<FileTransactionLockOwner | null> {
  let lastTransientError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_LEASE_OBSERVATION_RETRIES; attempt += 1) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      return isLockOwner(parsed) ? parsed : null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (!isTransientLeaseObservationError(error)) return null;
      lastTransientError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  throw new LeaseObservationContentionError(lockPath, { cause: lastTransientError });
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockSnapshot {
  readonly identity: string;
  readonly abandoned: boolean;
  readonly ownerToken: string | null;
  readonly ownerGeneration: string | null;
}

function ownerGeneration(owner: FileTransactionLockOwner): string {
  return `${owner.pid}:${owner.processInstanceId}:${owner.token}:${owner.createdAt}`;
}

const MAX_TRANSIENT_LEASE_OBSERVATION_RETRIES = 8;

class LeaseObservationContentionError extends Error {
  readonly code = 'EAGAIN';

  constructor(lockPath: string, options?: ErrorOptions) {
    super(`lease observation remained transiently unavailable for ${lockPath}`, options);
    this.name = 'LeaseObservationContentionError';
  }
}

function isTransientLeaseObservationError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

async function inspectLockOnce(lockPath: string): Promise<LockSnapshot | null | 'unstable'> {
  let statBefore;
  try {
    statBefore = await fs.lstat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!statBefore.isFile() || statBefore.isSymbolicLink()) {
    return {
      identity: `unsafe:${statBefore.dev}:${statBefore.ino}`,
      abandoned: false,
      ownerToken: null,
      ownerGeneration: null,
    };
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const statAfter = await fs.lstat(lockPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (statAfter === null) return null;
  const beforeIdentity = `${statBefore.dev}:${statBefore.ino}:${statBefore.size}:${statBefore.mtimeMs}:${statBefore.ctimeMs}`;
  const afterIdentity = `${statAfter.dev}:${statAfter.ino}:${statAfter.size}:${statAfter.mtimeMs}:${statAfter.ctimeMs}`;
  if (beforeIdentity !== afterIdentity) return 'unstable';

  let owner: FileTransactionLockOwner | null = null;
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    owner = isLockOwner(parsed) ? parsed : null;
  } catch {
    owner = null;
  }
  const ageMs = Date.now() - statAfter.mtimeMs;
  const abandoned =
    owner === null ? ageMs >= INVALID_LOCK_GRACE_MS : !processIsAlive(owner.pid);
  return {
    identity: `${afterIdentity}:${sha256Bytes(bytes)}`,
    abandoned,
    ownerToken: owner?.token ?? null,
    ownerGeneration: owner === null ? null : ownerGeneration(owner),
  };
}

async function inspectLock(lockPath: string): Promise<LockSnapshot | null> {
  let lastTransientError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_LEASE_OBSERVATION_RETRIES; attempt += 1) {
    try {
      const snapshot = await inspectLockOnce(lockPath);
      if (snapshot !== 'unstable') return snapshot;
    } catch (error) {
      if (!isTransientLeaseObservationError(error)) throw error;
      lastTransientError = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  if (lastTransientError !== undefined) {
    throw new LeaseObservationContentionError(lockPath, { cause: lastTransientError });
  }
  throw new AtomicFileTransactionError(`could not obtain a stable lease snapshot for ${lockPath}`);
}

async function releaseOwnedLease(
  leasePath: string,
  transientAsContention = false,
  testOptions?: FileTransactionLockTestOptions,
): Promise<void> {
  // A claimed main lease cannot be replaced while its live owner runs; generation reaper paths
  // are never reused. Direct unlink therefore avoids a second fallible owner read while remaining
  // ownership-safe. Windows sharing violations are transient, not successful releases.
  let lastTransientError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_LEASE_OBSERVATION_RETRIES; attempt += 1) {
    try {
      await testOptions?.beforeLeaseUnlink?.(leasePath, attempt);
      await fs.unlink(leasePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (!isTransientLeaseObservationError(error)) throw error;
      lastTransientError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  if (transientAsContention) {
    throw new LeaseObservationContentionError(leasePath, { cause: lastTransientError });
  }
  throw new AtomicFileTransactionError(
    `could not release owned lease ${leasePath}`,
    { cause: lastTransientError },
  );
}

function releaseIntentPath(filePath: string, ownerToken: string): string {
  return path.join(
    path.dirname(filePath),
    `.kodax-atomic-${targetKey(filePath)}-released-${ownerToken}.lease`,
  );
}

function reaperCompletionPath(reaperPath: string): string {
  return `${reaperPath}.completed`;
}

const locallyCompletedLeaseGenerations = new Set<string>();
const locallyCompletedReaperMarkers = new Set<string>();

async function snapshotIsAbandoned(filePath: string, snapshot: LockSnapshot): Promise<boolean> {
  if (snapshot.abandoned) return true;
  if (snapshot.ownerToken === null || snapshot.ownerGeneration === null) return false;
  if (locallyCompletedLeaseGenerations.has(snapshot.ownerGeneration)) return true;
  const intent = await inspectLock(releaseIntentPath(filePath, snapshot.ownerToken));
  return intent?.ownerGeneration === snapshot.ownerGeneration;
}

async function publishReleaseIntent(
  filePath: string,
  owner: FileTransactionLockOwner,
  testOptions?: FileTransactionLockTestOptions,
): Promise<string> {
  const intentPath = releaseIntentPath(filePath, owner.token);
  const stagedIntentPath = siblingPath(filePath, 'release-owner');
  await fs.writeFile(stagedIntentPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  try {
    await testOptions?.beforeReleaseIntentPublish?.(intentPath);
    await fs.link(stagedIntentPath, intentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = await inspectLock(intentPath);
      if (existing?.ownerGeneration !== ownerGeneration(owner)) {
        await releaseOwnedLease(stagedIntentPath).catch(() => {});
        throw new AtomicFileTransactionError(
          `release intent does not match owned lease generation at ${intentPath}`,
          { cause: error },
        );
      }
    } else {
      await releaseOwnedLease(stagedIntentPath).catch(() => {});
      throw error;
    }
  }
  // The immutable intent link is the logical release commit point. A leftover staging hard link
  // is not scanned as proof and cannot affect later generations, so cleanup must not flip success.
  await releaseOwnedLease(stagedIntentPath, false, testOptions).catch(() => {});
  return intentPath;
}

async function publishReaperCompletion(
  filePath: string,
  reaperPath: string,
  owner: FileTransactionLockOwner,
): Promise<string> {
  const completionPath = reaperCompletionPath(reaperPath);
  const stagedPath = siblingPath(filePath, 'reaper-completion-owner');
  await fs.writeFile(stagedPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(stagedPath, completionPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await releaseOwnedLease(stagedPath).catch(() => {});
      throw error;
    }
    const existing = await inspectLock(completionPath);
    if (existing?.ownerGeneration !== ownerGeneration(owner)) {
      await releaseOwnedLease(stagedPath).catch(() => {});
      throw new AtomicFileTransactionError(
        `reaper completion does not match owned generation at ${completionPath}`,
        { cause: error },
      );
    }
  }
  await releaseOwnedLease(stagedPath).catch(() => {});
  return completionPath;
}

async function releaseMainLease(
  filePath: string,
  lockPath: string,
  owner: FileTransactionLockOwner,
  testOptions?: FileTransactionLockTestOptions,
): Promise<void> {
  const generation = ownerGeneration(owner);
  try {
    // First exhaust the physical unlink while no release proof is visible. Once an intent is
    // published, successors may reap this generation, so the old owner must never unlink the
    // caller-visible path again (it could already belong to a newer generation).
    await releaseOwnedLease(lockPath, false, testOptions);
    locallyCompletedLeaseGenerations.delete(generation);
    return;
  } catch (releaseError) {
    try {
      await publishReleaseIntent(filePath, owner, testOptions);
      // The immutable exact-generation intent is the logical release commit point. A successor
      // owns physical cleanup; returning success avoids duplicate retries of completed work.
      return;
    } catch (publishError) {
      // No cross-process proof exists. Same-process successors can still recover this exact
      // generation after this call returns; other processes remain fail-closed.
      locallyCompletedLeaseGenerations.add(generation);
      throw new AggregateError(
        [releaseError, publishError],
        `main lease release and release intent publication both failed for ${lockPath}`,
      );
    }
  }
}

async function liveReaperMarkerExists(
  filePath: string,
  testOptions?: FileTransactionLockTestOptions,
): Promise<boolean> {
  const entries = await fs.readdir(path.dirname(filePath), { withFileTypes: true });
  const markerPaths = entries
    .filter(
      (entry) =>
        entry.name.startsWith(transactionReaperPrefix(filePath)) && entry.name.endsWith('.lease'),
    )
    .map((entry) => path.join(path.dirname(filePath), entry.name));
  let liveMarker = false;
  for (const markerPath of markerPaths) {
    const observed = await inspectLock(markerPath);
    if (observed === null) continue;
    const completion = await inspectLock(reaperCompletionPath(markerPath));
    const completed =
      locallyCompletedReaperMarkers.has(markerPath) ||
      (observed.ownerGeneration !== null &&
        completion?.ownerGeneration === observed.ownerGeneration);
    if (completed) {
      await releaseOwnedLease(markerPath, false, testOptions).then(
        () => {
          locallyCompletedReaperMarkers.delete(markerPath);
          void releaseOwnedLease(reaperCompletionPath(markerPath)).catch(() => {});
        },
        () => undefined,
      );
      continue;
    }
    if (!observed.abandoned) {
      liveMarker = true;
      continue;
    }
    // Marker paths contain a random generation token and are never reused. Re-checking identity
    // therefore makes cleanup safe even when several waiters discover the same dead marker.
    const current = await inspectLock(markerPath);
    if (current?.identity !== observed.identity || !current.abandoned) continue;
    await releaseOwnedLease(markerPath, true, testOptions);
  }
  return liveMarker;
}

async function quarantineAbandonedLock(
  filePath: string,
  lockPath: string,
  owner: FileTransactionLockOwner,
  testOptions?: FileTransactionLockTestOptions,
): Promise<boolean> {
  const observed = await inspectLock(lockPath);
  if (observed === null) return true;
  if (!(await snapshotIsAbandoned(filePath, observed))) return false;
  await testOptions?.afterAbandonedObserved?.(lockPath);

  // Reaper marker paths are generation-unique and never reused. Multiple reapers may observe the
  // same dead lock, but normal claimers remain gated until every live marker is gone, and each
  // reaper must prove the main lock still has the exact observed identity before moving it.
  const reaperOwner: FileTransactionLockOwner = {
    ...owner,
    token: randomUUID(),
    createdAt: Date.now(),
  };
  const reaperPath = transactionReaperPath(filePath, reaperOwner.token);
  const stagedReaperPath = siblingPath(filePath, 'marker-owner');
  await fs.writeFile(stagedReaperPath, JSON.stringify(reaperOwner), { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(stagedReaperPath, reaperPath);
  } catch (error) {
    await fs.unlink(stagedReaperPath).catch(() => {});
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  await fs.unlink(stagedReaperPath).catch(() => {});

  try {
    await testOptions?.afterReaperClaimed?.(lockPath, reaperPath);
    const current = await inspectLock(lockPath);
    if (current === null) return true;
    if (
      !(await snapshotIsAbandoned(filePath, current)) ||
      current.identity !== observed.identity
    )
      return false;
    if ((await readLockOwner(reaperPath))?.token !== reaperOwner.token) return false;

    const quarantinePath = `${lockPath}.abandoned-${process.pid}-${randomUUID()}`;
    try {
      await fs.rename(lockPath, quarantinePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EEXIST') return true;
      return false;
    }
    await fs.unlink(quarantinePath).catch(() => {});
    if (current.ownerGeneration !== null) {
      locallyCompletedLeaseGenerations.delete(current.ownerGeneration);
    }
    if (current.ownerToken !== null) {
      await releaseOwnedLease(releaseIntentPath(filePath, current.ownerToken)).catch(() => {});
    }
    return true;
  } finally {
    await releaseOwnedLease(reaperPath, false, testOptions).then(
      () => {
        locallyCompletedReaperMarkers.delete(reaperPath);
      },
      async () => {
        try {
          await publishReaperCompletion(filePath, reaperPath, reaperOwner);
        } catch {
          locallyCompletedReaperMarkers.add(reaperPath);
        }
      },
    );
  }
}

async function recoverDisplacedBackup(filePath: string, conflictMessage: string): Promise<void> {
  let canonicalExists = false;
  try {
    await fs.lstat(filePath);
    canonicalExists = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw new AtomicFileTransactionError(`${conflictMessage}; canonical recovery check failed`);
    }
  }

  const prefix = `.kodax-atomic-${targetKey(filePath)}-`;
  let candidates: string[];
  try {
    candidates = (await fs.readdir(path.dirname(filePath), { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(prefix) &&
          (entry.name.includes('-previous-') || entry.name.includes('-rollback-')),
      )
      .map((entry) => path.join(path.dirname(filePath), entry.name));
  } catch (error) {
    throw new AtomicFileTransactionError(
      `${conflictMessage}; could not inspect displaced recovery backups`,
      { cause: error },
    );
  }
  if (candidates.length === 0) return;
  if (canonicalExists) {
    // canonical is the committed/racing winner. Active backup names are reserved for an absent
    // canonical recovery, so archive leftovers from a crash-after-install or failed cleanup now.
    for (const candidate of candidates) {
      try {
        await fs.rename(candidate, siblingPath(filePath, 'retained'));
      } catch (error) {
        throw new AtomicFileTransactionError(
          `${conflictMessage}; could not archive committed recovery backup ${candidate}`,
          { cause: error },
        );
      }
    }
    return;
  }
  if (candidates.length > 1) {
    throw new AtomicFileTransactionError(
      `${conflictMessage}; multiple recovery backups retained: ${candidates.join(', ')}`,
    );
  }
  const backupPath = candidates[0]!;
  try {
    await fs.link(backupPath, filePath);
    await fs.unlink(backupPath).catch(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw new AtomicFileTransactionError(
      `${conflictMessage}; canonical recovery failed, original retained at ${backupPath}`,
      { cause: error },
    );
  }
}

/**
 * Archive obsolete recovery candidates before a lock owner intentionally removes canonical.
 * Retained archives preserve bytes for manual recovery but are never mistaken for a live
 * interrupted transaction if the same Session is created again later.
 */
export async function retireFileTransactionBackups(filePath: string): Promise<void> {
  const prefix = `.kodax-atomic-${targetKey(filePath)}-`;
  const entries = await fs.readdir(path.dirname(filePath), { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        (entry.name.includes('-previous-') || entry.name.includes('-rollback-')),
    )
    .map((entry) => path.join(path.dirname(filePath), entry.name));
  for (const candidate of candidates) {
    await fs.rename(candidate, siblingPath(filePath, 'retained'));
  }
}

/**
 * Serialize every read/mutation of a caller-visible file across Space processes.
 *
 * The fully initialized linked lease is visible before a mutation can displace the canonical path,
 * so a cooperating reader can never interpret that transaction-only ENOENT as an empty store.
 * Dead owners and sufficiently old malformed leases are quarantined; a valid owner whose PID is
 * still alive is never stolen, even if its event loop has been suspended. If a dead transaction
 * left a displaced backup, the next owner restores it before exposing the canonical path.
 */
export interface FileTransactionLockTestOptions {
  /** @internal Shortens only the bounded waiter timeout in deterministic tests. */
  readonly waitTimeoutMs?: number;
  /** @internal Pauses after a complete owner record is staged but before its atomic claim. */
  readonly afterOwnerStaged?: (lockPath: string) => void | Promise<void>;
  /** @internal Pauses stale contenders after observation, before single-reaper election. */
  readonly afterAbandonedObserved?: (lockPath: string) => void | Promise<void>;
  /** @internal Pauses the elected reaper before its identity re-check and quarantine. */
  readonly afterReaperClaimed?: (lockPath: string, reaperPath: string) => void | Promise<void>;
  /** @internal Injects deterministic Windows sharing failures during lease release. */
  readonly beforeLeaseUnlink?: (leasePath: string, attempt: number) => void | Promise<void>;
  /** @internal Creates deterministic EEXIST/unsafe release-intent races in tests. */
  readonly beforeReleaseIntentPublish?: (intentPath: string) => void | Promise<void>;
}

export async function withFileTransactionLock<T>(
  filePath: string,
  conflictMessage: string,
  operation: () => Promise<T>,
  testOptions?: FileTransactionLockTestOptions,
): Promise<T> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = transactionLockPath(filePath);
  const stagedOwnerPath = siblingPath(filePath, 'lock-owner');
  const owner: FileTransactionLockOwner = {
    version: 1,
    pid: process.pid,
    processInstanceId: PROCESS_INSTANCE_ID,
    token: randomUUID(),
    createdAt: Date.now(),
  };
  const deadline = Date.now() + (testOptions?.waitTimeoutMs ?? LOCK_WAIT_TIMEOUT_MS);
  await fs.writeFile(stagedOwnerPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  try {
    await testOptions?.afterOwnerStaged?.(lockPath);
  } catch (error) {
    await fs.unlink(stagedOwnerPath).catch(() => {});
    throw error;
  }

  for (;;) {
    if (Date.now() >= deadline) {
      await fs.unlink(stagedOwnerPath).catch(() => {});
      throw new AtomicFileTransactionError(
        `${conflictMessage}; timed out waiting for the cross-process transaction lock`,
      );
    }
    try {
      if (await liveReaperMarkerExists(filePath, testOptions)) {
        throw Object.assign(new Error('transaction recovery in progress'), { code: 'EEXIST' });
      }
      // The fully-written staging inode is claimed with an exclusive hard link. There is no
      // observable owner-less lease, and a losing initializer never owns (or removes) lockPath.
      await fs.link(stagedOwnerPath, lockPath);
      if (await liveReaperMarkerExists(filePath, testOptions)) {
        await releaseMainLease(filePath, lockPath, owner, testOptions);
        throw Object.assign(new Error('transaction recovery in progress'), { code: 'EEXIST' });
      }
      await fs.unlink(stagedOwnerPath).catch(() => {});
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if ((error as NodeJS.ErrnoException).code === 'EAGAIN') {
          await new Promise<void>((resolve) => setTimeout(resolve, LOCK_POLL_MS));
          continue;
        }
        await fs.unlink(stagedOwnerPath).catch(() => {});
        throw error;
      }
      try {
        await quarantineAbandonedLock(filePath, lockPath, owner, testOptions);
      } catch (observationError) {
        if ((observationError as NodeJS.ErrnoException).code !== 'EAGAIN') {
          await fs.unlink(stagedOwnerPath).catch(() => {});
          throw observationError;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_POLL_MS));
      continue;
    }
  }

  try {
    // Recovery is intentionally checked for every owner, not only after a stale lease. A previous
    // attempt can have released its healthy lease after failing to restore the displaced inode; in
    // that state the backup is still authoritative and canonical ENOENT must not become "empty".
    await recoverDisplacedBackup(filePath, conflictMessage);
    return await operation();
  } finally {
    await releaseMainLease(filePath, lockPath, owner, testOptions);
  }
}

async function linkIntoPlace(tempPath: string, filePath: string): Promise<void> {
  // A hard-link install is exclusive and atomic: unlike rename(), it never
  // replaces a path that another process created during the commit window.
  await fs.link(tempPath, filePath);
  // Once the link exists the commit is complete. A failed best-effort cleanup
  // must not make callers report failure after the target was installed.
  await fs.unlink(tempPath).catch(() => {});
}

async function restoreDisplaced(
  displacedPath: string,
  filePath: string,
  conflictMessage: string,
  testHooks?: ConditionalFileMutationTestHooks,
): Promise<never> {
  try {
    await testHooks?.beforeRestore?.(filePath, displacedPath);
  } catch (error) {
    throw new Error(`${conflictMessage}; original retained at ${displacedPath}`, { cause: error });
  }
  try {
    await fs.link(displacedPath, filePath);
    await fs.unlink(displacedPath).catch(() => {});
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(`${conflictMessage}; original retained at ${displacedPath}`);
    }
    // Windows does not replace an existing destination with rename(), so this
    // is a safe recovery path for a directory or symbolic link that cannot be
    // restored with a hard link. A racing creator remains untouched and the
    // displaced entry remains available at displacedPath.
    if (process.platform === 'win32') {
      try {
        await fs.rename(displacedPath, filePath);
      } catch (restoreError) {
        const restoreCode = (restoreError as NodeJS.ErrnoException).code;
        if (restoreCode === 'EEXIST' || restoreCode === 'EPERM') {
          throw new Error(`${conflictMessage}; original retained at ${displacedPath}`);
        }
        throw new Error(`${conflictMessage}; recovery copy retained at ${displacedPath}`);
      }
      throw new Error(conflictMessage);
    }
    throw new Error(`${conflictMessage}; recovery copy retained at ${displacedPath}`);
  }
  throw new Error(conflictMessage);
}

/** @internal Deterministic failure/displacement controls used by atomic persistence tests. */
export interface ConditionalFileMutationTestHooks {
  readonly afterDisplace?: (filePath: string, displacedPath: string) => void | Promise<void>;
  readonly beforeDisplacedStat?: (filePath: string, displacedPath: string) => void | Promise<void>;
  readonly beforeDisplacedRead?: (filePath: string, displacedPath: string) => void | Promise<void>;
  readonly beforeInstall?: (filePath: string, displacedPath: string) => void | Promise<void>;
  readonly beforeRemoveFinalize?: (filePath: string, displacedPath: string) => void | Promise<void>;
  readonly beforeRestore?: (filePath: string, displacedPath: string) => void | Promise<void>;
}

/** @internal Test-only controls for exercising the Windows replacement path cross-platform. */
export interface ReplaceFileWithoutAliasesTestHooks {
  readonly forceRenameFallback?: boolean;
  readonly beforeFallbackDisplace?: (filePath: string) => void | Promise<void>;
  readonly beforeFallbackInstall?: (filePath: string) => void | Promise<void>;
}

/**
 * Replace a file without ever opening the caller-visible target for writing.
 *
 * POSIX rename provides the normal atomic fast path and replaces a directory
 * entry rather than following a symlink or hard link. Windows can reject that
 * operation with EEXIST/EPERM when the target exists. In that case the current
 * directory entry is moved aside, verified as a regular file, and the new inode
 * is installed with an exclusive hard link. A creator racing the short
 * displacement window is therefore preserved instead of being overwritten.
 */
export async function replaceFileWithoutFollowingAliases(
  filePath: string,
  bytes: Buffer,
  conflictMessage: string,
  testHooks?: ReplaceFileWithoutAliasesTestHooks,
): Promise<void> {
  const tempPath = siblingPath(filePath, 'new');
  const displacedPath = siblingPath(filePath, 'previous');
  await fs.writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });

  if (testHooks?.forceRenameFallback !== true) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') {
        await fs.unlink(tempPath).catch(() => {});
        throw err;
      }
    }
  }

  // Windows rename fallback must not displace an entry that cannot be restored
  // through the regular-file hard-link recovery path below. The post-rename
  // verification remains necessary for races, but this preflight preserves an
  // already-present directory or symbolic link at its caller-visible path.
  try {
    const existingStat = await fs.lstat(filePath);
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error(`${conflictMessage}; unsafe existing entry retained at ${filePath}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  let displacedEntry = false;
  let displacedRegular = false;
  try {
    await testHooks?.beforeFallbackDisplace?.(filePath);
    try {
      await fs.rename(filePath, displacedPath);
      displacedEntry = true;
      let displacedStat;
      try {
        displacedStat = await fs.lstat(displacedPath);
      } catch (err) {
        throw new Error(
          `${conflictMessage}; unverified previous entry retained at ${displacedPath}`,
          { cause: err },
        );
      }
      if (displacedStat.isSymbolicLink() || !displacedStat.isFile()) {
        throw new Error(`${conflictMessage}; unsafe previous entry retained at ${displacedPath}`);
      }
      displacedRegular = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    }

    await testHooks?.beforeFallbackInstall?.(filePath);
    try {
      await linkIntoPlace(tempPath, filePath);
    } catch (err) {
      if (!displacedRegular && (err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(conflictMessage, { cause: err });
      }
      throw err;
    }
    if (displacedRegular) await fs.unlink(displacedPath).catch(() => {});
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    if (displacedEntry) {
      const detail = err instanceof Error ? err.message : String(err);
      return await restoreDisplaced(displacedPath, filePath, `${conflictMessage}: ${detail}`);
    }
    throw err;
  }
}

export async function writeNewFileExclusive(
  filePath: string,
  bytes: Buffer,
  changedMessage: string,
): Promise<void> {
  const tempPath = siblingPath(filePath, 'new');
  await fs.writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await linkIntoPlace(tempPath, filePath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(changedMessage);
    throw err;
  }
}

/**
 * Replace exactly the file version represented by expectedHash.
 *
 * The current target is first atomically displaced and the displaced bytes are
 * then verified. This closes the read-check-rename race: a concurrent version
 * is restored instead of being overwritten. A new target is installed with an
 * exclusive hard link, so a writer racing the short displacement window also
 * cannot be overwritten.
 */
export async function replaceFileIfUnchanged(
  filePath: string,
  bytes: Buffer,
  expectedHash: string,
  changedMessage: string,
  maxCurrentBytes: number,
  testHooks?: ConditionalFileMutationTestHooks,
): Promise<void> {
  const tempPath = siblingPath(filePath, 'new');
  const displacedPath = siblingPath(filePath, 'previous');
  await fs.writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await fs.rename(filePath, displacedPath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(changedMessage);
    throw err;
  }

  try {
    await testHooks?.afterDisplace?.(filePath, displacedPath);
    await testHooks?.beforeDisplacedStat?.(filePath, displacedPath);
    const stat = await fs.lstat(displacedPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxCurrentBytes) {
      await fs.unlink(tempPath).catch(() => {});
      return await restoreDisplaced(displacedPath, filePath, changedMessage, testHooks);
    }
    await testHooks?.beforeDisplacedRead?.(filePath, displacedPath);
    const displacedBytes = await fs.readFile(displacedPath);
    if (sha256Bytes(displacedBytes) !== expectedHash) {
      await fs.unlink(tempPath).catch(() => {});
      return await restoreDisplaced(displacedPath, filePath, changedMessage, testHooks);
    }
    await testHooks?.beforeInstall?.(filePath, displacedPath);
    try {
      await linkIntoPlace(tempPath, filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`${changedMessage}; previous version retained at ${displacedPath}`);
      }
      return await restoreDisplaced(
        displacedPath,
        filePath,
        `${changedMessage}: ${err instanceof Error ? err.message : String(err)}`,
        testHooks,
      );
    }
    await fs.unlink(displacedPath).catch(() => {});
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    try {
      await fs.lstat(filePath);
    } catch (canonicalError) {
      const code = (canonicalError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return await restoreDisplaced(
          displacedPath,
          filePath,
          `${changedMessage}: ${err instanceof Error ? err.message : String(err)}`,
          testHooks,
        );
      }
      throw new Error(`${changedMessage}; original retained at ${displacedPath}`, {
        cause: canonicalError,
      });
    }
    try {
      await fs.lstat(displacedPath);
      throw new Error(`${changedMessage}; previous version retained at ${displacedPath}`, {
        cause: err,
      });
    } catch (backupError) {
      if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError;
    }
    throw err;
  }
}

export async function removeFileIfUnchanged(
  filePath: string,
  expectedHash: string,
  changedMessage: string,
  maxCurrentBytes: number,
  testHooks?: ConditionalFileMutationTestHooks,
): Promise<void> {
  const displacedPath = siblingPath(filePath, 'rollback');
  try {
    await fs.rename(filePath, displacedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(changedMessage);
    throw err;
  }
  try {
    await testHooks?.afterDisplace?.(filePath, displacedPath);
    await testHooks?.beforeDisplacedStat?.(filePath, displacedPath);
    const stat = await fs.lstat(displacedPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxCurrentBytes) {
      return restoreDisplaced(displacedPath, filePath, changedMessage, testHooks);
    }
    await testHooks?.beforeDisplacedRead?.(filePath, displacedPath);
    const bytes = await fs.readFile(displacedPath);
    if (sha256Bytes(bytes) !== expectedHash) {
      return restoreDisplaced(displacedPath, filePath, changedMessage, testHooks);
    }
    await testHooks?.beforeRemoveFinalize?.(filePath, displacedPath);
    await fs.unlink(displacedPath);
  } catch (error) {
    try {
      await fs.lstat(filePath);
    } catch (canonicalError) {
      const code = (canonicalError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return await restoreDisplaced(
          displacedPath,
          filePath,
          `${changedMessage}: ${error instanceof Error ? error.message : String(error)}`,
          testHooks,
        );
      }
      throw new Error(`${changedMessage}; original retained at ${displacedPath}`, {
        cause: canonicalError,
      });
    }
    try {
      await fs.lstat(displacedPath);
      throw new Error(`${changedMessage}; previous version retained at ${displacedPath}`, {
        cause: error,
      });
    } catch (backupError) {
      if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError;
    }
    throw error;
  }
}

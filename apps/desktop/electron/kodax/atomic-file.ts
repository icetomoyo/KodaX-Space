import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function sha256Bytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function siblingPath(filePath: string, purpose: string): string {
  return path.join(
    path.dirname(filePath),
    `.kodax-atomic-${purpose}-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
  );
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
): Promise<never> {
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
    const stat = await fs.lstat(displacedPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxCurrentBytes) {
      await fs.unlink(tempPath).catch(() => {});
      return await restoreDisplaced(displacedPath, filePath, changedMessage);
    }
    const displacedBytes = await fs.readFile(displacedPath);
    if (sha256Bytes(displacedBytes) !== expectedHash) {
      await fs.unlink(tempPath).catch(() => {});
      return await restoreDisplaced(displacedPath, filePath, changedMessage);
    }
    try {
      await linkIntoPlace(tempPath, filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`${changedMessage}; previous version retained at ${displacedPath}`);
      }
      throw err;
    }
    await fs.unlink(displacedPath).catch(() => {});
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

export async function removeFileIfUnchanged(
  filePath: string,
  expectedHash: string,
  changedMessage: string,
  maxCurrentBytes: number,
): Promise<void> {
  const displacedPath = siblingPath(filePath, 'rollback');
  try {
    await fs.rename(filePath, displacedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(changedMessage);
    throw err;
  }
  const stat = await fs.lstat(displacedPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxCurrentBytes) {
    return restoreDisplaced(displacedPath, filePath, changedMessage);
  }
  const bytes = await fs.readFile(displacedPath);
  if (sha256Bytes(bytes) !== expectedHash) {
    return restoreDisplaced(displacedPath, filePath, changedMessage);
  }
  await fs.unlink(displacedPath).catch(() => {});
}

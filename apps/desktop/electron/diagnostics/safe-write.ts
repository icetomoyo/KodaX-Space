import { randomUUID } from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

interface FileOperationError {
  readonly code?: unknown;
}

export interface SafeReplaceOperations {
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly rm: (filePath: string, options: { force: boolean }) => Promise<void>;
  readonly stat: (filePath: string) => Promise<unknown>;
}

const defaultOperations: SafeReplaceOperations = {
  rename: async (from, to) => rename(from, to),
  rm: async (filePath, options) => rm(filePath, options),
  stat: async (filePath) => stat(filePath),
};

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as FileOperationError).code)
    : undefined;
}

async function exists(filePath: string, operations: SafeReplaceOperations): Promise<boolean> {
  try {
    await operations.stat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Replace a destination while preserving its previous contents if the final rename fails. */
export async function replaceFilePreservingExisting(
  temporary: string,
  destination: string,
  operations: SafeReplaceOperations = defaultOperations,
): Promise<void> {
  try {
    // POSIX replaces an existing file atomically. Windows succeeds here when the target is absent.
    await operations.rename(temporary, destination);
    return;
  } catch (firstError) {
    const code = errorCode(firstError);
    if (!['EACCES', 'EEXIST', 'EPERM'].includes(code ?? '')) throw firstError;
    if (!(await exists(destination, operations))) throw firstError;

    const backup = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${randomUUID()}.previous`,
    );
    await operations.rename(destination, backup);
    try {
      await operations.rename(temporary, destination);
    } catch (replaceError) {
      try {
        await operations.rename(backup, destination);
      } catch (restoreError) {
        throw new AggregateError(
          [replaceError, restoreError],
          'Diagnostic export replacement and rollback both failed',
        );
      }
      throw replaceError;
    }
    // The new export is already safely installed. A stale hidden backup is preferable to
    // reporting failure after success; the next overwrite can still proceed independently.
    await operations.rm(backup, { force: true }).catch(() => undefined);
  }
}

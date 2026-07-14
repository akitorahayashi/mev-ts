import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lstatIfPresent } from './absence';
import { throwWithCleanupError } from './cleanup-error';
import { transactionDirectory } from './transaction';

const noFailure = Symbol('noFailure');

/**
 * Replaces a directory after its successor has been fully built in a sibling
 * staging directory.
 *
 * The final swap uses rename calls with best-effort rollback for in-process
 * failures. It is not crash-safe: a process or host crash between moving the
 * old directory aside and moving the new directory into place can leave the
 * target path absent with the backup sibling still present.
 */
export async function replaceDirectoryAfterBuild(
  path: string,
  buildDirectory: (tmp: string) => Promise<void>,
): Promise<void> {
  const transaction = await transactionDirectory(path);
  const staging = join(transaction, 'staging');
  const backup = join(transaction, 'backup');

  let primary: unknown = noFailure;
  let retainTransaction = false;
  try {
    await mkdir(staging);
    await buildDirectory(staging);

    const present = (await lstatIfPresent(path)) !== null;
    if (!present) {
      await rename(staging, path);
    } else {
      await rename(path, backup);
      try {
        await rename(staging, path);
      } catch (error) {
        try {
          await rename(backup, path);
        } catch (restoreError) {
          retainTransaction = true;
          throw new AggregateError(
            [error, restoreError],
            `Failed to replace ${path} and restore its previous contents. Previous contents remain in ${backup}.`,
          );
        }
        throw error;
      }
    }
  } catch (error) {
    primary = error;
  }

  if (!retainTransaction) {
    try {
      await rm(transaction, { recursive: true, force: true });
    } catch (cleanup) {
      if (primary !== noFailure) {
        throwWithCleanupError(
          primary,
          cleanup,
          `Failed to clean up directory replacement transaction for ${path}.`,
        );
      }
      throw cleanup;
    }
  }
  if (primary !== noFailure) throw primary;
}

import { lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lstatIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import { transactionDirectory } from './transaction';

const executableBits = 0o111;

async function directoriesMatch(left: string, right: string): Promise<boolean> {
  const [leftNames, rightNames] = await Promise.all([
    readdir(left),
    readdir(right),
  ]);
  leftNames.sort();
  rightNames.sort();
  if (
    leftNames.length !== rightNames.length ||
    leftNames.some((name, index) => name !== rightNames[index])
  ) {
    return false;
  }

  for (const name of leftNames) {
    const leftPath = join(left, name);
    const rightPath = join(right, name);
    const [leftStats, rightStats] = await Promise.all([
      lstat(leftPath),
      lstat(rightPath),
    ]);

    if (leftStats.isDirectory() && rightStats.isDirectory()) {
      if (!(await directoriesMatch(leftPath, rightPath))) return false;
      continue;
    }
    if (!leftStats.isFile() || !rightStats.isFile()) return false;
    if (
      (leftStats.mode & executableBits) !==
      (rightStats.mode & executableBits)
    ) {
      return false;
    }
    if (leftStats.size !== rightStats.size) return false;

    const [leftContents, rightContents] = await Promise.all([
      readFile(leftPath),
      readFile(rightPath),
    ]);
    if (!leftContents.equals(rightContents)) return false;
  }

  return true;
}

/**
 * Reconciles a directory after its desired state has been fully built in a
 * sibling staging directory. An equivalent directory is left in place.
 *
 * The final swap uses rename calls with best-effort rollback for in-process
 * failures. It is not crash-safe: a process or host crash between moving the
 * old directory aside and moving the new directory into place can leave the
 * target path absent with the backup sibling still present.
 */
export async function replaceDirectoryAfterBuild(
  path: string,
  buildDirectory: (tmp: string) => Promise<void>,
): Promise<boolean> {
  const transaction = await transactionDirectory(path);
  const staging = join(transaction, 'staging');
  const backup = join(transaction, 'backup');

  let retainTransaction = false;
  return runWithCleanup(
    async () => {
      await mkdir(staging);
      await buildDirectory(staging);

      const current = await lstatIfPresent(path);
      if (current?.isDirectory() && (await directoriesMatch(staging, path))) {
        return false;
      }
      if (!current) {
        await rename(staging, path);
        return true;
      }
      await rename(path, backup);
      try {
        await rename(staging, path);
      } catch (error) {
        try {
          await rename(backup, path);
        } catch (restoreError) {
          // The restore failed too: keep the transaction so the previous
          // contents remain recoverable at `backup`.
          retainTransaction = true;
          throw new AggregateError(
            [error, restoreError],
            `Failed to replace ${path} and restore its previous contents. Previous contents remain in ${backup}.`,
          );
        }
        throw error;
      }
      return true;
    },
    async () => {
      if (!retainTransaction) {
        await rm(transaction, { recursive: true, force: true });
      }
    },
    `Failed to clean up directory replacement transaction for ${path}.`,
  );
}

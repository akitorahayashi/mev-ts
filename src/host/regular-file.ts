import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lstatIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import { swapWithBackup, transactionDirectory } from './transaction';

async function matchesRegularFile(
  path: string,
  expected: Buffer,
  expectedMode: number,
): Promise<boolean> {
  const current = await lstatIfPresent(path);
  if (!current?.isFile() || current.isSymbolicLink()) return false;
  if ((current.mode & 0o111) !== (expectedMode & 0o111)) return false;
  if (current.size !== expected.byteLength) return false;
  return (await readFile(path)).equals(expected);
}

export async function reconcileRegularFile(
  path: string,
  contents: Buffer,
  mode: number,
): Promise<boolean> {
  if (await matchesRegularFile(path, contents, mode)) return false;

  const current = await lstatIfPresent(path);
  const transaction = await transactionDirectory(path);
  const staged = join(transaction, 'staged');
  const backup = join(transaction, 'backup');
  let retainTransaction = false;

  await runWithCleanup(
    async () => {
      await writeFile(staged, contents, { flag: 'wx' });
      await chmod(staged, mode);
      if (!current?.isDirectory()) {
        await rename(staged, path);
        return;
      }
      await swapWithBackup({ dest: path, staged, backup }, () => {
        retainTransaction = true;
      });
    },
    async () => {
      if (!retainTransaction) {
        await rm(transaction, { force: true, recursive: true });
      }
    },
    `Failed to clean up regular-file transaction for ${path}.`,
  );

  return true;
}

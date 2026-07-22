import { readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { lstatIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import { swapWithBackup, transactionDirectory } from './transaction';

/** Whether `link` is a symlink whose target is exactly `target`. */
export async function isSymlinkTo(
  link: string,
  target: string,
): Promise<boolean> {
  const stats = await lstatIfPresent(link);
  if (!stats?.isSymbolicLink()) {
    return false;
  }
  return (await readlink(link)) === target;
}

/**
 * Replace `link` with a symlink to `target`. Files and symlinks are replaced by
 * one atomic rename. Directories are moved to a sibling backup first, with
 * best-effort rollback if installing the symlink fails.
 *
 * A crash during directory replacement can leave the destination absent with
 * its previous contents retained in the transaction directory.
 */
export async function placeSymlink(
  link: string,
  target: string,
): Promise<void> {
  const stats = await lstatIfPresent(link);
  const transaction = await transactionDirectory(link);
  const staged = join(transaction, 'staged');
  const backup = join(transaction, 'backup');
  let retainTransaction = false;
  await runWithCleanup(
    async () => {
      await symlink(target, staged);
      if (!stats?.isDirectory()) {
        await rename(staged, link);
        return;
      }
      await swapWithBackup({ dest: link, staged, backup }, () => {
        retainTransaction = true;
      });
    },
    async () => {
      if (!retainTransaction) {
        await rm(transaction, { force: true, recursive: true });
      }
    },
    `Failed to clean up symlink transaction for ${link}.`,
  );
}

import { readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { lstatIfPresent, readTextIfPresent } from './absence';
import { writeFileAtomically } from './atomic-file';
import { runWithCleanup } from './cleanup-error';
import { swapWithBackup, transactionDirectory } from './transaction';

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
 * Replace a symlink at `path` with a regular file holding the contents it
 * currently resolves to, detaching later writes from the link target. Returns
 * whether the path was materialized. A regular file is already detached and a
 * dangling link holds no contents to keep, so both are left untouched.
 */
export async function materializeSymlink(path: string): Promise<boolean> {
  const stats = await lstatIfPresent(path);
  if (!stats?.isSymbolicLink()) return false;
  const contents = await readTextIfPresent(path);
  if (contents === null) return false;
  await writeFileAtomically(path, contents);
  return true;
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

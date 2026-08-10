import { readlink, symlink } from 'node:fs/promises';
import { lstatIfPresent } from './absence';
import { withSwapTransaction } from './transaction';

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
  await withSwapTransaction(link, 'symlink', async ({ staged, install }) => {
    await symlink(target, staged);
    await install();
  });
}

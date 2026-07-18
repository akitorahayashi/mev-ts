import { readlink, rename, rm, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { lstatIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import { transactionDirectory } from './transaction';

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
 * Replace `link` with a symlink to `target`. A pre-existing symlink is
 * replaced; a pre-existing regular file or directory is removed before the new
 * symlink is moved into place.
 *
 * The new symlink is staged under a sibling temporary directory and renamed
 * over the destination, so a crash mid-operation leaves either the old link or
 * the new one, never a missing link (same-directory rename is atomic on APFS).
 */
export async function placeSymlink(
  link: string,
  target: string,
): Promise<void> {
  const stats = await lstatIfPresent(link);
  const staging = await transactionDirectory(link);
  await runWithCleanup(
    async () => {
      const staged = join(staging, basename(link));
      await symlink(target, staged);
      // A real file or directory cannot be atomically replaced by rename, so
      // remove it first; a symlink or absent destination is replaced atomically.
      if (stats && !stats.isSymbolicLink()) {
        await rm(link, { force: true, recursive: true });
      }
      await rename(staged, link);
    },
    () => rm(staging, { force: true, recursive: true }),
    `Failed to clean up symlink transaction for ${link}.`,
  );
}

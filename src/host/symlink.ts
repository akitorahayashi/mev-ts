import { readlink, rename, rm, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ProvisioningError } from '../errors';
import { lstatIfPresent } from './absence';
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
 * replaced; a pre-existing regular file or directory is preserved unless
 * `overwrite` is set, so unmanaged user files are never silently destroyed.
 *
 * The new symlink is staged under a sibling temporary directory and renamed
 * over the destination, so a crash mid-operation leaves either the old link or
 * the new one, never a missing link (same-directory rename is atomic on APFS).
 */
export async function placeSymlink(
  link: string,
  target: string,
  overwrite: boolean,
): Promise<void> {
  const stats = await lstatIfPresent(link);
  if (stats && !stats.isSymbolicLink() && !overwrite) {
    throw new ProvisioningError(
      `Refusing to replace unmanaged file at ${link}; re-run with --overwrite to replace it.`,
    );
  }
  const staging = await transactionDirectory(link);
  try {
    const staged = join(staging, basename(link));
    await symlink(target, staged);
    // A real file or directory (overwrite is set, per the guard above) cannot
    // be atomically replaced by rename, so remove it first; a symlink or absent
    // destination is replaced atomically by the rename.
    if (stats && !stats.isSymbolicLink()) {
      await rm(link, { force: true, recursive: true });
    }
    await rename(staged, link);
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

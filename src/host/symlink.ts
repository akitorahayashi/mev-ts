import { mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProvisioningError } from '../errors';
import { lstatIfPresent } from './absence';

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
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { force: true, recursive: true });
  await symlink(target, link);
}

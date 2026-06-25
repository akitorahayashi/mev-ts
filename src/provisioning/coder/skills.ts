import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isSymlinkTo, lstatOrNull, placeSymlink } from '../../host/symlink';

/**
 * Reconcile `skillsDir` to hold exactly one symlink per enabled skill, each
 * pointing at the deployed source `sourceDir/<name>`. Symlinks for disabled or
 * removed skills are dropped. Agent skill directories symlink to these entries,
 * so updating this directory reflects everywhere without re-provisioning.
 *
 * Returns whether any entry was created, retargeted, or removed.
 */
export async function buildSkills(
  sourceDir: string,
  enabled: readonly string[],
  skillsDir: string,
): Promise<boolean> {
  await mkdir(skillsDir, { recursive: true });
  let changed = false;

  const entries = await readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) {
      continue;
    }
    if (!enabled.includes(entry.name)) {
      await rm(join(skillsDir, entry.name), { force: true });
      changed = true;
    }
  }

  for (const name of enabled) {
    const link = join(skillsDir, name);
    const target = join(sourceDir, name);
    if (await isSymlinkTo(link, target)) {
      continue;
    }
    const stats = await lstatOrNull(link);
    if (stats && !stats.isSymbolicLink()) {
      throw new Error(
        `Skills entry '${link}' already exists and is not a managed symlink.`,
      );
    }
    await placeSymlink(link, target, false);
    changed = true;
  }

  return changed;
}

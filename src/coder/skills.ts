import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileManagedLinks } from '../host/managed-links';

/**
 * Reconcile `skillsDir` to hold exactly one symlink per enabled skill, each
 * pointing at the deployed source `sourceDir/<name>`. Symlinks into `sourceDir`
 * for disabled or removed skills are dropped (unmanaged symlinks are left
 * alone). Agent skill directories symlink to these entries, so updating this
 * directory reflects everywhere without re-provisioning.
 *
 * Returns whether any entry was created, retargeted, or removed.
 */
export async function buildSkills(
  sourceDir: string,
  enabled: readonly string[],
  skillsDir: string,
): Promise<boolean> {
  await mkdir(skillsDir, { recursive: true });
  return reconcileManagedLinks(
    skillsDir,
    [`${sourceDir}/`],
    enabled.map((name) => ({
      path: join(skillsDir, name),
      target: join(sourceDir, name),
    })),
  );
}

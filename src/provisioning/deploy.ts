import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { lstatIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { replaceDirectoryAfterBuild } from '../host/directory-replacement';
import { type RoleAssetChange, roleAssetChanges } from './role-state';
import { readAssetIntents } from './signature';

export interface DeployResult {
  readonly role: string;
  readonly changes: readonly RoleAssetChange[];
  readonly error?: string;
}

/**
 * Materialize every embedded asset under a role into the deploy store. Desired
 * state is staged first; an equivalent role remains in place, while drift is
 * replaced with best-effort rollback for in-process failures.
 */
export async function deployRole(
  role: string,
  context: Context,
): Promise<DeployResult> {
  const intents = await readAssetIntents(role, context.assets);
  const destDir = deployedDir(role, context.home);
  const changes = await roleAssetChanges(role, intents, context.home);
  if (intents.length === 0 && (await lstatIfPresent(destDir)) === null) {
    return { role, changes };
  }

  await replaceDirectoryAfterBuild(destDir, async (tmp) => {
    const createdDirs = new Set<string>();
    for (const intent of intents) {
      const relative = intent.key.slice(`${role}/`.length);
      const dest = join(tmp, relative);
      const destParent = dirname(dest);
      if (!createdDirs.has(destParent)) {
        await mkdir(destParent, { recursive: true });
        createdDirs.add(destParent);
      }
      await writeFile(dest, intent.content);
      if (intent.executable) {
        await chmod(dest, 0o755);
      }
    }
  });

  return { role, changes };
}

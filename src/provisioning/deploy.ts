import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedDir } from '../assets/ref';
import type { Context } from '../host/context';
import { replaceDirectoryAfterBuild } from '../host/directory-replacement';
import { compareRole, type RoleAssetChange } from './role-state';
import { readAssetIntents } from './signature';

export interface DeployResult {
  readonly role: string;
  readonly changes: readonly RoleAssetChange[];
  readonly error?: string;
}

/**
 * Materialize every embedded asset under a role into the deploy store. Desired
 * state is staged first; an equivalent role remains in place, while drift is
 * replaced with rollback and home-scoped recovery for interrupted publication.
 */
export async function deployRole(
  role: string,
  context: Context,
): Promise<DeployResult> {
  const intents = await readAssetIntents(role, context.assets);
  const destDir = deployedDir(role, context.home);
  const { changes, deploymentCurrent } = await compareRole(
    role,
    intents,
    context.home,
  );
  if (deploymentCurrent) {
    return { role, changes };
  }

  await replaceDirectoryAfterBuild(
    destDir,
    async (tmp) => {
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
    },
    context,
  );

  return { role, changes };
}

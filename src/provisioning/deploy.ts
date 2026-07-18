import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { lstatIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { replaceDirectoryAfterBuild } from '../host/directory-replacement';

export interface DeployResult {
  readonly role: string;
  /** True when the role's assets were (re)written; false when left untouched. */
  readonly deployed: boolean;
  /** Top-level file/dir names under `role/global/`, e.g. `.zshenv`, `alias/`. */
  readonly files: readonly string[];
  readonly error?: string;
}

async function exists(path: string): Promise<boolean> {
  return (await lstatIfPresent(path)) !== null;
}

function topLevelFiles(
  role: string,
  keys: readonly string[],
): readonly string[] {
  const prefix = `${role}/global/`;
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    const slash = rel.indexOf('/');
    seen.add(slash === -1 ? rel : rel.slice(0, slash + 1));
  }
  return [...seen];
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
  const keys = context.assets.keysByPrefix(`${role}/`);
  const destDir = deployedDir(role, context.home);
  const present = await exists(destDir);
  if (keys.length === 0 && !present) {
    return { role, deployed: false, files: [] };
  }

  const deployed = await replaceDirectoryAfterBuild(destDir, async (tmp) => {
    const createdDirs = new Set<string>();
    for (const key of keys) {
      const relative = key.slice(`${role}/`.length);
      const dest = join(tmp, relative);
      const destParent = dirname(dest);
      if (!createdDirs.has(destParent)) {
        await mkdir(destParent, { recursive: true });
        createdDirs.add(destParent);
      }
      await writeFile(dest, await context.assets.read(key));
      if (context.assets.isExecutable(key)) {
        await chmod(dest, 0o755);
      }
    }
  });

  return { role, deployed, files: topLevelFiles(role, keys) };
}

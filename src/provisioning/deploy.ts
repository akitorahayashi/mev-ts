import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedDir, deployRoot } from '../assets/ref';
import { lstatIfPresent } from '../host/absence';
import type { Context } from '../host/context';

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
 * Materialize every embedded asset under a role into the deploy store. A
 * present role is left untouched unless `overwrite` is set, in which case it is
 * removed and rewritten so stale files never linger.
 */
export async function deployRole(
  role: string,
  context: Context,
): Promise<DeployResult> {
  const destDir = deployedDir(role, context.home);
  const present = await exists(destDir);
  if (present && !context.overwrite) {
    return { role, deployed: false, files: [] };
  }
  if (present) {
    await rm(destDir, { recursive: true, force: true });
  }
  const keys = context.assets.keysByPrefix(`${role}/`);
  for (const key of keys) {
    const dest = join(context.home, deployRoot, key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await context.assets.read(key));
    if (context.assets.isExecutable(key)) {
      await chmod(dest, 0o755);
    }
  }
  return { role, deployed: true, files: topLevelFiles(role, keys) };
}

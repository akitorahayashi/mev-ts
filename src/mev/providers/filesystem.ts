import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProvisioningError } from '../errors';
import { type AssetRef, deployedDir, deployedPath } from '../resources/asset';
import type {
  ApplyResult,
  Context,
  Resource,
  ResourceState,
} from '../resources/model';
import { type HostPath, resolveHostPath, symbolic } from '../resources/path';

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

/** Materializes an embedded asset to its deployed path under the config root. */
function deployAsset(ref: AssetRef): Resource {
  return {
    id: `fs:asset:${ref.key}`,
    dependencies: [],
    concurrencyGroup: 'filesystem',
    async inspect(context: Context): Promise<ResourceState> {
      const dest = deployedPath(ref, context.home);
      const stats = await lstatOrNull(dest);
      if (stats === null) {
        return { kind: 'missing' };
      }
      if (!stats.isFile()) {
        return { kind: 'diverged', detail: 'not a regular file' };
      }
      const desired = await context.assets.read(ref.key);
      const current = await readFile(dest, 'utf8').catch(() => null);
      if (current === null) {
        return { kind: 'missing' };
      }
      return current === desired
        ? { kind: 'present' }
        : { kind: 'diverged', detail: 'content differs' };
    },
    async apply(context: Context): Promise<ApplyResult> {
      const dest = deployedPath(ref, context.home);
      const desired = await context.assets.read(ref.key);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, desired);
      return { detail: dest };
    },
  };
}

function directory(target: HostPath): Resource {
  return {
    id: `fs:directory:${symbolic(target)}`,
    dependencies: [],
    concurrencyGroup: 'filesystem',
    async inspect(context: Context): Promise<ResourceState> {
      const path = resolveHostPath(target, context.home);
      const stats = await lstatOrNull(path);
      if (stats === null) {
        return { kind: 'missing' };
      }
      return stats.isDirectory()
        ? { kind: 'present' }
        : { kind: 'diverged', detail: 'not a directory' };
    },
    async apply(context: Context): Promise<ApplyResult> {
      const path = resolveHostPath(target, context.home);
      await mkdir(path, { recursive: true });
      return { detail: path };
    },
  };
}

/**
 * Links a host path to a deployed asset. A pre-existing symlink is replaced; a
 * pre-existing regular file or directory is preserved unless `overwrite` is set,
 * so unmanaged user files are never silently destroyed.
 */
function assetSymlink(source: AssetRef, dest: HostPath): Resource {
  return {
    id: `fs:symlink:${symbolic(dest)}`,
    dependencies: [`fs:asset:${source.key}`],
    concurrencyGroup: 'filesystem',
    async inspect(context: Context): Promise<ResourceState> {
      const link = resolveHostPath(dest, context.home);
      const target = deployedPath(source, context.home);
      const stats = await lstatOrNull(link);
      if (stats === null) {
        return { kind: 'missing' };
      }
      if (!stats.isSymbolicLink()) {
        return { kind: 'diverged', detail: 'unmanaged file present' };
      }
      const current = await readlink(link);
      return current === target
        ? { kind: 'present' }
        : { kind: 'diverged', detail: `-> ${current}` };
    },
    async apply(context: Context): Promise<ApplyResult> {
      const link = resolveHostPath(dest, context.home);
      const target = deployedPath(source, context.home);
      const stats = await lstatOrNull(link);
      if (stats && !stats.isSymbolicLink() && !context.overwrite) {
        throw new ProvisioningError(
          `Refusing to replace unmanaged file at ${link}. Re-run with --overwrite to replace it.`,
        );
      }
      await mkdir(dirname(link), { recursive: true });
      await rm(link, { force: true, recursive: true });
      await symlink(target, link);
      return { detail: `${link} -> ${target}` };
    },
  };
}

interface TreeEntry {
  readonly link: string;
  readonly target: string;
}

function planEntries(
  refs: readonly AssetRef[],
  sourcePrefix: string,
  destDir: HostPath,
  home: string,
): TreeEntry[] {
  const root = resolveHostPath(destDir, home);
  return refs.map((ref) => ({
    link: join(root, ref.key.slice(sourcePrefix.length)),
    target: deployedPath(ref, home),
  }));
}

async function staleLinks(
  root: string,
  managedRoot: string,
  expected: ReadonlySet<string>,
): Promise<string[]> {
  if ((await lstatOrNull(root)) === null) {
    return [];
  }
  const base = managedRoot.endsWith('/') ? managedRoot : `${managedRoot}/`;
  const stale: string[] = [];
  for (const name of await readdir(root, { recursive: true })) {
    const path = join(root, name);
    if (expected.has(path)) {
      continue;
    }
    const stats = await lstatOrNull(path);
    if (!stats?.isSymbolicLink()) {
      continue;
    }
    const target = await readlink(path).catch(() => '');
    if (target.startsWith(base)) {
      stale.push(path);
    }
  }
  return stale;
}

/**
 * Mirrors a set of deployed assets into a destination directory as symlinks,
 * preserving their relative layout. Owns the managed-link state of `destDir`:
 * links pointing into the deploy root that are no longer expected are pruned,
 * while unrelated user files in the directory are left untouched.
 */
function linkTree(
  destDir: HostPath,
  refs: readonly AssetRef[],
  sourcePrefix: string,
): Resource {
  return {
    id: `fs:linktree:${symbolic(destDir)}`,
    dependencies: refs.map((ref) => `fs:asset:${ref.key}`),
    concurrencyGroup: 'filesystem',
    async inspect(context: Context): Promise<ResourceState> {
      const root = resolveHostPath(destDir, context.home);
      const entries = planEntries(refs, sourcePrefix, destDir, context.home);
      let present = 0;
      for (const { link, target } of entries) {
        const stats = await lstatOrNull(link);
        if (stats?.isSymbolicLink() && (await readlink(link)) === target) {
          present += 1;
        }
      }
      const stale = await staleLinks(
        root,
        deployedDir(sourcePrefix, context.home),
        new Set(entries.map((entry) => entry.link)),
      );
      if (present === entries.length && stale.length === 0) {
        return { kind: 'present' };
      }
      if (present === 0 && stale.length === 0) {
        return { kind: 'missing' };
      }
      const detail =
        stale.length > 0
          ? `${stale.length} stale, ${entries.length - present} to link`
          : `${entries.length - present} to link`;
      return { kind: 'diverged', detail };
    },
    async apply(context: Context): Promise<ApplyResult> {
      const root = resolveHostPath(destDir, context.home);
      const entries = planEntries(refs, sourcePrefix, destDir, context.home);
      for (const { link, target } of entries) {
        await mkdir(dirname(link), { recursive: true });
        await rm(link, { force: true });
        await symlink(target, link);
      }
      const stale = await staleLinks(
        root,
        deployedDir(sourcePrefix, context.home),
        new Set(entries.map((entry) => entry.link)),
      );
      for (const link of stale) {
        await rm(link, { force: true });
      }
      return { detail: `${entries.length} links, ${stale.length} pruned` };
    },
  };
}

export const fs = {
  deployAsset,
  directory,
  symlink: assetSymlink,
  linkTree,
};

import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProvisioningError } from '../errors';
import { type AssetRef, deployedPath } from '../resources/asset';
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

export const fs = {
  deployAsset,
  directory,
  symlink: assetSymlink,
};

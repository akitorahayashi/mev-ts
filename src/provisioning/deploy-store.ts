import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { errorMessage, ProvisioningError } from '../errors';
import { readDirentsIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { mevPath, symbolic } from '../host/path';
import { isTransactionArtifact } from '../host/transaction';
import { appliedRoot } from './applied';
import { allTargets } from './registry';

export interface DeployStorePruneRequest {
  readonly roles: readonly string[];
  readonly targets: readonly string[];
}

export interface DeployStorePruneReport {
  readonly roles: readonly string[];
  readonly appliedTargets: readonly string[];
}

async function removePath(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function pruneUnlisted(
  root: string,
  listed: readonly string[],
): Promise<string[]> {
  const children = await readDirentsIfPresent(root);
  if (children === null) return [];
  children.sort((left, right) => left.name.localeCompare(right.name));

  const listedSet = new Set(listed);
  const removed: string[] = [];
  for (const child of children) {
    if (child.isDirectory() && isTransactionArtifact(child.name)) continue;
    if (listedSet.has(child.name)) continue;
    await removePath(join(root, child.name));
    removed.push(child.name);
  }
  return removed;
}

/**
 * Remove deploy-store state for targets that no longer exist in the registry.
 * The cleanup is confined to provisioning-owned state under ~/.mev.
 *
 * Obsolete roles are deleted on the project assumption that an unregistered
 * target no longer owns active outputs. Transaction directories are retained
 * because they may contain recovery backups or belong to a concurrent run.
 */
export async function pruneDeployStore(
  request: DeployStorePruneRequest,
  context: Pick<Context, 'home'>,
): Promise<DeployStorePruneReport> {
  const roleRoot = deployedDir('', context.home);

  try {
    const roles = await pruneUnlisted(roleRoot, request.roles);
    const appliedTargets = await pruneUnlisted(
      appliedRoot(context.home),
      request.targets,
    );
    return { roles, appliedTargets };
  } catch (error) {
    throw new ProvisioningError(
      `Failed to prune deploy store under ${symbolic(mevPath())}: ${errorMessage(error)}`,
    );
  }
}

export async function pruneObsoleteDeployState(
  context: Pick<Context, 'home'>,
): Promise<DeployStorePruneReport> {
  const registered = allTargets();
  return pruneDeployStore(
    {
      roles: registered.map((target) => target.role),
      targets: registered.map((target) => target.name),
    },
    context,
  );
}

import { rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deployRoot } from '../assets/ref';
import { errorMessage, ProvisioningError } from '../errors';
import { isNotFound, readDirentsIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { mevRoot } from '../host/path';

export interface DeployStorePruneRequest {
  readonly roles: readonly string[];
  readonly targets: readonly string[];
}

export interface DeployStorePruneReport {
  readonly roles: readonly string[];
  readonly appliedTargets: readonly string[];
}

function isRolePathCovered(path: string, roles: readonly string[]): boolean {
  return roles.some((role) => role === path || role.startsWith(`${path}/`));
}

async function removePath(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (isNotFound(error)) return;
    if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') return;
    throw error;
  }
}

async function pruneRoles(
  root: string,
  roles: readonly string[],
  relative: string,
  removed: string[],
): Promise<void> {
  const directory = relative === '' ? root : join(root, relative);
  const children = await readDirentsIfPresent(directory);
  if (children === null) return;
  children.sort((left, right) => left.name.localeCompare(right.name));

  const roleSet = new Set(roles);
  for (const child of children) {
    const path = relative === '' ? child.name : `${relative}/${child.name}`;
    const absolute = join(root, path);
    const covered = isRolePathCovered(path, roles);
    if (!covered) {
      await removePath(absolute);
      removed.push(path);
      continue;
    }

    if (roleSet.has(path)) continue;
    if (!child.isDirectory()) {
      await removePath(absolute);
      removed.push(path);
      continue;
    }

    await pruneRoles(root, roles, path, removed);
    await removeEmptyDirectory(absolute);
  }
}

async function pruneAppliedTargets(
  root: string,
  targets: readonly string[],
): Promise<string[]> {
  const children = await readDirentsIfPresent(root);
  if (children === null) return [];
  children.sort((left, right) => left.name.localeCompare(right.name));

  const targetSet = new Set(targets);
  const removed: string[] = [];
  for (const child of children) {
    if (targetSet.has(child.name)) continue;
    await removePath(join(root, child.name));
    removed.push(child.name);
  }
  return removed;
}

/**
 * Remove deploy-store state for targets that no longer exist in the registry.
 * The cleanup is confined to provisioning-owned state under ~/.mev.
 */
export async function pruneDeployStore(
  request: DeployStorePruneRequest,
  context: Pick<Context, 'home'>,
): Promise<DeployStorePruneReport> {
  const roleRoot = join(context.home, deployRoot);
  const appliedRoot = join(context.home, mevRoot, 'applied');

  try {
    const roles: string[] = [];
    await pruneRoles(roleRoot, request.roles, '', roles);
    const appliedTargets = await pruneAppliedTargets(
      appliedRoot,
      request.targets,
    );
    return { roles, appliedTargets };
  } catch (error) {
    throw new ProvisioningError(
      `Failed to prune deploy store under ~/${mevRoot}: ${errorMessage(error)}`,
    );
  }
}

export function deployStorePruneLines(
  report: DeployStorePruneReport,
): readonly string[] {
  const lines: string[] = [];
  for (const role of report.roles) {
    lines.push(`  Removed obsolete role state: ${role}`);
  }
  for (const target of report.appliedTargets) {
    lines.push(`  Removed obsolete applied marker: ${target}`);
  }
  return lines;
}

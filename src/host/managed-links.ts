import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readDirentsIfPresent, readlinkIfPresent } from './absence';
import { isSymlinkTo, placeSymlink } from './symlink';

/** A symlink mev wants to exist: `path` -> `target`, both absolute. */
export interface DesiredLink {
  readonly path: string;
  readonly target: string;
}

/**
 * Reconcile the symlinks directly under `root` to exactly `desired`. mev owns
 * only symlinks whose target begins with one of `managedPrefixes`: such a link
 * that is not desired is removed, and every desired link is created or
 * retargeted. Non-symlink entries and symlinks pointing outside the managed
 * prefixes are left untouched. Returns whether anything was removed, created, or
 * retargeted. Sole owner of the place-desired/prune-stale reconciliation shared
 * by the tree and coder link fan-outs. Desired links are placed before stale ones
 * are pruned, so a placement failure leaves the stale links in place (a benign
 * leftover the next successful run prunes) rather than a directory stripped of
 * both its old and new links.
 */
export async function reconcileManagedLinks(
  root: string,
  managedPrefixes: readonly string[],
  desired: readonly DesiredLink[],
): Promise<boolean> {
  const prefixes = managedPrefixes.map((prefix) =>
    prefix.endsWith('/') ? prefix : `${prefix}/`,
  );
  const desiredPaths = new Set(desired.map((link) => link.path));
  let changed = false;

  for (const link of desired) {
    if (await isSymlinkTo(link.path, link.target)) continue;
    await placeSymlink(link.path, link.target);
    changed = true;
  }

  const entries = (await readDirentsIfPresent(root)) ?? [];
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (desiredPaths.has(path)) continue;
    const target = await readlinkIfPresent(path);
    if (target && prefixes.some((prefix) => target.startsWith(prefix))) {
      await rm(path, { force: true });
      changed = true;
    }
  }

  return changed;
}

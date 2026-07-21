import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../assets/ref';
import type { AssetSource } from '../assets/registry';
import { errorMessage } from '../errors';
import { lstatIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { mapWithConcurrency } from '../host/task-pool';
import { appliedPath, readApplied } from './applied';
import { targetSignature } from './signature';
import type { Target } from './target';

export type SyncReason = 'unapplied' | 'signature' | 'drift';

export interface TargetScanResult {
  readonly target: Target;
  readonly signature: string;
  readonly reasons: readonly SyncReason[];
}

export interface TargetScanError {
  readonly target: Target;
  readonly error: string;
}

/**
 * A per-target scan outcome. Scanning is read-only, so one unreadable marker or
 * role directory yields a `TargetScanError` for that target alone rather than
 * aborting the batch and discarding every other target's classification.
 */
export type TargetScan = TargetScanResult | TargetScanError;

export function isScanError(scan: TargetScan): scan is TargetScanError {
  return 'error' in scan;
}

const SCAN_CONCURRENCY = 8;

type RoleEntry =
  | { readonly kind: 'directory'; readonly path: string }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly content: string;
      readonly executable: boolean;
    }
  | { readonly kind: 'other'; readonly path: string };

function entryOrder(left: RoleEntry, right: RoleEntry): number {
  return (
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
  );
}

async function embeddedEntries(
  role: string,
  assets: AssetSource,
): Promise<RoleEntry[]> {
  const prefix = `${role}/`;
  const directories = new Set<string>();
  const keys = [...assets.keysByPrefix(prefix)].sort();
  const files = await Promise.all(
    keys.map(async (key): Promise<RoleEntry> => {
      const path = key.slice(prefix.length);
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        directories.add(parts.slice(0, index).join('/'));
      }
      return {
        kind: 'file',
        path,
        content: Buffer.from(await assets.read(key)).toString('base64'),
        executable: assets.isExecutable(key),
      };
    }),
  );

  return [
    ...[...directories].map((path): RoleEntry => ({ kind: 'directory', path })),
    ...files,
  ].sort(entryOrder);
}

async function walkDeployed(
  root: string,
  relative: string,
  entries: RoleEntry[],
): Promise<void> {
  const directory = relative === '' ? root : join(root, relative);
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));

  for (const child of children) {
    const path = relative === '' ? child.name : join(relative, child.name);
    const absolute = join(root, path);
    if (child.isDirectory()) {
      entries.push({ kind: 'directory', path });
      await walkDeployed(root, path, entries);
      continue;
    }
    if (child.isFile()) {
      const [content, stats] = await Promise.all([
        readFile(absolute),
        lstat(absolute),
      ]);
      entries.push({
        kind: 'file',
        path,
        content: content.toString('base64'),
        executable: (stats.mode & 0o111) !== 0,
      });
      continue;
    }
    entries.push({ kind: 'other', path });
  }
}

async function deployedEntries(
  role: string,
  home: string,
): Promise<RoleEntry[]> {
  const root = deployedDir(role, home);
  const rootStats = await lstatIfPresent(root);
  if (rootStats === null) return [];
  if (!rootStats.isDirectory()) return [{ kind: 'other', path: '' }];

  const entries: RoleEntry[] = [];
  await walkDeployed(root, '', entries);
  return entries.sort(entryOrder);
}

/** Whether a deployed role differs from the assets embedded in this binary. */
async function roleHasDrift(
  role: string,
  context: Pick<Context, 'home' | 'assets'>,
): Promise<boolean> {
  const [expected, actual] = await Promise.all([
    embeddedEntries(role, context.assets),
    deployedEntries(role, context.home),
  ]);
  return JSON.stringify(expected) !== JSON.stringify(actual);
}

async function scanTarget(
  target: Target,
  context: Context,
): Promise<TargetScan> {
  try {
    const signature = await targetSignature(target, context.assets);
    const [applied, drifted] = await Promise.all([
      readApplied(appliedPath(context.home, target.name)),
      roleHasDrift(target.role, context),
    ]);
    const reasons: SyncReason[] = [];
    if (applied === null) reasons.push('unapplied');
    else if (applied !== signature) reasons.push('signature');
    if (drifted) reasons.push('drift');
    return { target, signature, reasons };
  } catch (error) {
    return { target, error: errorMessage(error) };
  }
}

/** Scan targets concurrently while preserving their registry order. */
export function scanTargets(
  targets: readonly Target[],
  context: Context,
): Promise<readonly TargetScan[]> {
  return mapWithConcurrency(targets, SCAN_CONCURRENCY, (target) =>
    scanTarget(target, context),
  );
}

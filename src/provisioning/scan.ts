import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir } from '../assets/ref';
import { errorMessage } from '../errors';
import { lstatIfPresent } from '../host/absence';
import type { Context } from '../host/context';
import { mapWithConcurrency } from '../host/task-pool';
import { appliedPath, readApplied } from './applied';
import { type AssetIntent, readAssetIntents, signatureOf } from './signature';
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

/**
 * The role as the embedded assets declare it. Built from the intents the
 * signature already read, so a scan reads each asset once rather than once per
 * consumer.
 */
function embeddedEntries(
  role: string,
  intents: readonly AssetIntent[],
): RoleEntry[] {
  const prefix = `${role}/`;
  const directories = new Set<string>();
  const files = intents.map((intent): RoleEntry => {
    const path = intent.key.slice(prefix.length);
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
    return {
      kind: 'file',
      path,
      content: Buffer.from(intent.content).toString('base64'),
      executable: intent.executable,
    };
  });

  return [
    ...[...directories].map((path): RoleEntry => ({ kind: 'directory', path })),
    ...files,
  ].sort(entryOrder);
}

/**
 * Compare entry by entry rather than by serialized form: JSON-string equality
 * would rest on two construction sites happening to insert properties in the
 * same order, which nothing enforces.
 */
function entriesDiffer(
  expected: readonly RoleEntry[],
  actual: readonly RoleEntry[],
): boolean {
  if (expected.length !== actual.length) return true;
  return expected.some((left, index) => {
    const right = actual[index];
    if (!right || right.kind !== left.kind || right.path !== left.path) {
      return true;
    }
    if (left.kind !== 'file' || right.kind !== 'file') return false;
    return (
      left.content !== right.content || left.executable !== right.executable
    );
  });
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

async function roleHasDrift(
  role: string,
  intents: readonly AssetIntent[],
  home: string,
): Promise<boolean> {
  return entriesDiffer(
    embeddedEntries(role, intents),
    await deployedEntries(role, home),
  );
}

async function scanTarget(
  target: Target,
  context: Context,
): Promise<TargetScan> {
  try {
    const intents = await readAssetIntents(target.role, context.assets);
    const signature = signatureOf(target, intents);
    const [applied, drifted] = await Promise.all([
      readApplied(appliedPath(context.home, target.name)),
      roleHasDrift(target.role, intents, context.home),
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

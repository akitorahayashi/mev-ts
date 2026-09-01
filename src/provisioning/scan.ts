import { errorMessage } from '../errors';
import type { Context } from '../host/context';
import { mapWithConcurrency } from '../host/task-pool';
import { appliedPath, readApplied } from './applied';
import { roleAssetChanges } from './role-state';
import { readAssetIntents, signatureOf } from './signature';
import type { Target } from './target';

export type SyncReason = 'unapplied' | 'signature' | 'drift';

export interface TargetScanResult {
  readonly target: Target;
  readonly reasons: readonly SyncReason[];
}

export interface TargetScanError {
  readonly target: Target;
  readonly error: string;
}

export type TargetScan = TargetScanResult | TargetScanError;

export function isScanError(scan: TargetScan): scan is TargetScanError {
  return 'error' in scan;
}

const SCAN_CONCURRENCY = 8;

async function scanTarget(
  target: Target,
  context: Context,
): Promise<TargetScan> {
  try {
    const intents = await readAssetIntents(target.role, context.assets);
    const signature = signatureOf(target, intents);
    const [applied, changes] = await Promise.all([
      readApplied(appliedPath(context.home, target.name)),
      roleAssetChanges(target.role, intents, context.home),
    ]);
    const reasons: SyncReason[] = [];
    if (applied === null) reasons.push('unapplied');
    else if (applied !== signature) reasons.push('signature');
    if (changes.length > 0) reasons.push('drift');
    return { target, reasons };
  } catch (error) {
    return { target, error: errorMessage(error) };
  }
}

export function scanTargets(
  targets: readonly Target[],
  context: Context,
): Promise<readonly TargetScan[]> {
  return mapWithConcurrency(targets, SCAN_CONCURRENCY, (target) =>
    scanTarget(target, context),
  );
}

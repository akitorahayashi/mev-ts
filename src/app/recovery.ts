import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { isNotFound, readDirentsIfPresent } from '../host/absence';
import { mevPath, resolveHostPath } from '../host/path';
import { isTransactionArtifact } from '../host/transaction';
import { recoverTransactions } from '../host/transaction-record';
import { allTargets } from '../provisioning/registry';

function declaredPaths(value: unknown, home: string, paths: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (
    'kind' in value &&
    value.kind === 'home' &&
    'rel' in value &&
    typeof value.rel === 'string'
  ) {
    paths.add(resolveHostPath({ kind: 'home', rel: value.rel }, home));
    return;
  }
  for (const item of Object.values(value)) declaredPaths(item, home, paths);
}

async function inspectDirectory(
  path: string,
  recursive: boolean,
  prefix?: string,
): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) return;
  } catch (error) {
    if (
      isNotFound(error) ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    )
      return;
    throw error;
  }
  const entries = await readDirentsIfPresent(path);
  for (const entry of entries ?? []) {
    const child = join(path, entry.name);
    if (
      entry.isDirectory() &&
      isTransactionArtifact(entry.name) &&
      (!prefix || entry.name.startsWith(prefix))
    ) {
      throw new ProvisioningError(
        `Unrecorded transaction artifact at ${child}; ownership and publication cannot be proved. Retained state requires inspection.`,
      );
    }
    if (recursive && entry.isDirectory()) await inspectDirectory(child, true);
  }
}

export async function recoverHomeTransactions(home: string): Promise<void> {
  try {
    await recoverTransactions(home);
    await inspectDirectory(resolveHostPath(mevPath(), home), true);
    const paths = new Set<string>();
    for (const target of allTargets())
      declaredPaths(target.activations, home, paths);
    for (const path of paths) {
      await inspectDirectory(dirname(path), false, `.${basename(path)}.`);
      await inspectDirectory(path, false);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      'syscall' in error
    ) {
      throw new ProvisioningError(
        `Failed to inspect transaction recovery state for ${home}: ${errorMessage(error)}`,
      );
    }
    throw error;
  }
}

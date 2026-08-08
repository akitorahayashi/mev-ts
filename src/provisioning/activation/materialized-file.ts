import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AssetRef,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import { lstatIfPresent } from '../../host/absence';
import { runWithCleanup } from '../../host/cleanup-error';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { swapWithBackup, transactionDirectory } from '../../host/transaction';
import type { Activation, ActivationReport, Described } from './contract';
import { guarded } from './reconcile';

type MaterializedFileActivation = Extract<
  Activation,
  { kind: 'materializedFile' }
>;

export function materializeFile(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'materializedFile', source, dest };
}

export function describeMaterializedFile(
  activation: MaterializedFileActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedSymbolic(activation.source),
    dest: symbolic(activation.dest),
  };
}

async function matchesRegularFile(path: string, expected: Buffer) {
  const current = await lstatIfPresent(path);
  if (!current?.isFile() || current.isSymbolicLink()) return false;
  if (current.size !== expected.byteLength) return false;
  return (await readFile(path)).equals(expected);
}

async function placeRegularFile(
  path: string,
  contents: Buffer,
  mode: number,
): Promise<void> {
  const current = await lstatIfPresent(path);
  const transaction = await transactionDirectory(path);
  const staged = join(transaction, 'staged');
  const backup = join(transaction, 'backup');
  let retainTransaction = false;

  await runWithCleanup(
    async () => {
      await writeFile(staged, contents, { flag: 'wx' });
      await chmod(staged, mode);
      if (!current?.isDirectory()) {
        await rename(staged, path);
        return;
      }
      await swapWithBackup({ dest: path, staged, backup }, () => {
        retainTransaction = true;
      });
    },
    async () => {
      if (!retainTransaction) {
        await rm(transaction, { force: true, recursive: true });
      }
    },
    `Failed to clean up regular-file transaction for ${path}.`,
  );
}

export async function runMaterializedFile(
  activation: MaterializedFileActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeMaterializedFile(activation);
  return guarded(base, async () => {
    const source = deployedPath(activation.source, context.home);
    const dest = resolveHostPath(activation.dest, context.home);
    const contents = await readFile(source);
    if (await matchesRegularFile(dest, contents)) {
      return { ...base, status: 'unchanged' };
    }
    const sourceMode = (await stat(source)).mode & 0o7777;
    await placeRegularFile(dest, contents, sourceMode);
    return { ...base, status: 'changed' };
  });
}

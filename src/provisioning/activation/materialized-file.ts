import { readFile, stat } from 'node:fs/promises';
import {
  type AssetRef,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { reconcileRegularFile } from '../../host/regular-file';
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

export async function runMaterializedFile(
  activation: MaterializedFileActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeMaterializedFile(activation);
  return guarded(base, async () => {
    const source = deployedPath(activation.source, context.home);
    const dest = resolveHostPath(activation.dest, context.home);
    const contents = await readFile(source);
    const sourceMode = (await stat(source)).mode & 0o7777;
    const changed = await reconcileRegularFile(dest, contents, sourceMode);
    return { ...base, status: changed ? 'changed' : 'unchanged' };
  });
}

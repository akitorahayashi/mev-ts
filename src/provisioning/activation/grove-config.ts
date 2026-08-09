import { readFile, stat } from 'node:fs/promises';
import {
  type AssetRef,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import { readSshHost } from '../../github/ssh-host';
import { renderConfig } from '../../grove/config';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { reconcileRegularFile } from '../../host/regular-file';
import type { Activation, ActivationReport, Described } from './contract';
import { guarded } from './reconcile';

type GroveConfigActivation = Extract<Activation, { kind: 'groveConfig' }>;

export function groveConfig(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'groveConfig', source, dest };
}

export function groveConfigAssets(
  activation: GroveConfigActivation,
): readonly string[] {
  return [activation.source.key];
}

export function describeGroveConfig(
  activation: GroveConfigActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedSymbolic(activation.source),
    dest: symbolic(activation.dest),
  };
}

export async function runGroveConfig(
  activation: GroveConfigActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeGroveConfig(activation);
  return guarded(base, async () => {
    const source = deployedPath(activation.source, context.home);
    const [raw, sourceStats, sshHost] = await Promise.all([
      readFile(source, 'utf8'),
      stat(source),
      readSshHost(context.home),
    ]);
    const rendered = renderConfig(raw, sshHost, source);
    const dest = resolveHostPath(activation.dest, context.home);
    const changed = await reconcileRegularFile(
      dest,
      Buffer.from(rendered),
      sourceStats.mode & 0o7777,
    );
    return { ...base, status: changed ? 'changed' : 'unchanged' };
  });
}

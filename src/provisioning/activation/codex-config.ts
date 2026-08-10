import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AssetRef, deployedSymbolic } from '../../assets/ref';
import { mergeDeclared, tomlValueEqual } from '../../coder/codex-config';
import { ProvisioningError } from '../../errors';
import { lstatIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { loadToml, serializeToml } from '../../host/toml';
import type { Activation, ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { guarded } from './reconcile';

type CodexConfigActivation = Extract<Activation, { kind: 'codexConfig' }>;

export function codexConfig(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'codexConfig', source, dest };
}

export function describeCodexConfig(
  activation: CodexConfigActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedSymbolic(activation.source),
    dest: symbolic(activation.dest),
  };
}

/**
 * Enforce the declared TOML values into the codex-owned config file. The
 * destination is a regular file, never a symlink into the deploy store: codex
 * rewrites its config in place at runtime, and a symlink would route those
 * writes into the deployed role — permanent drift — while every deploy would
 * wipe codex's plugin and marketplace registrations.
 */
export async function runCodexConfig(
  activation: CodexConfigActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeCodexConfig(activation);
  return guarded(base, async () => {
    const declared = await readDeployedManifest(
      activation.source.key,
      context.home,
      loadToml,
      'Codex config',
    );
    const dest = resolveHostPath(activation.dest, context.home);
    const stats = await lstatIfPresent(dest);
    if (stats && !stats.isFile() && !stats.isSymbolicLink()) {
      throw new ProvisioningError(
        `Codex config destination must be a file: ${dest}`,
      );
    }
    const host = stats ? loadToml(await readFile(dest, 'utf8'), dest) : {};
    const merged = mergeDeclared(host, declared);
    // A pre-existing symlink is always materialized, even when the values
    // already match, because the symlink itself is the write-through hazard.
    if (stats?.isFile() && tomlValueEqual(merged, host)) {
      return { ...base, status: 'unchanged' };
    }
    await mkdir(dirname(dest), { recursive: true });
    // The atomic rename replaces the destination path itself, so a symlink
    // found there becomes a regular file instead of being written through.
    await writeFileAtomically(dest, serializeToml(merged));
    return { ...base, status: 'changed' };
  });
}

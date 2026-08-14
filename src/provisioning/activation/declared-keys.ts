import { type AssetRef, deployedSymbolic } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import { lstatIfPresent, readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';
import type { Context } from '../../host/context';
import { mergeDeclared, valueEqual } from '../../host/declared-merge';
import { loadJsonObject, serializeJson } from '../../host/json';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { loadToml, serializeToml } from '../../host/toml';
import type { Activation, ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { guarded } from './reconcile';

type DeclaredKeysActivation = Extract<Activation, { kind: 'declaredKeys' }>;

type DocumentFormat = DeclaredKeysActivation['format'];

/**
 * Reading and writing one supported document format. The format is declared per
 * activation rather than derived from the asset's extension, so a destination
 * states what it is instead of resting on a filename convention.
 */
interface DocumentCodec {
  load(raw: string, source: string): Record<string, unknown>;
  serialize(value: Record<string, unknown>): string;
}

const codecs: Readonly<Record<DocumentFormat, DocumentCodec>> = {
  toml: { load: loadToml, serialize: serializeToml },
  json: { load: loadJsonObject, serialize: serializeJson },
};

export function declaredKeys(
  source: AssetRef,
  dest: HostPath,
  format: DocumentFormat,
): Activation {
  return { kind: 'declaredKeys', source, dest, format };
}

/** Parse a declared document, for both the runner and the build-time check. */
export function parseDeclared(
  raw: string,
  source: string,
  format: DocumentFormat,
): Record<string, unknown> {
  return codecs[format].load(raw, source);
}

export function describeDeclaredKeys(
  activation: DeclaredKeysActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedSymbolic(activation.source),
    dest: symbolic(activation.dest),
  };
}

/**
 * Enforce the declared keys into an application-owned config file. The
 * destination is a regular file, never a symlink into the deploy store: the
 * application rewrites its config in place at runtime, and a symlink would route
 * those writes into the deployed role — permanent drift — while every deploy
 * would wipe them. Claude Code's `enabledPlugins` and codex's plugin and
 * marketplace registrations are the state that cost.
 */
export async function runDeclaredKeys(
  activation: DeclaredKeysActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeDeclaredKeys(activation);
  const codec = codecs[activation.format];
  return guarded(base, async () => {
    const declared = await readDeployedManifest(
      activation.source.key,
      context.home,
      codec.load,
      'Declared config',
    );
    const dest = resolveHostPath(activation.dest, context.home);
    const stats = await lstatIfPresent(dest);
    if (stats && !stats.isFile() && !stats.isSymbolicLink()) {
      throw new ProvisioningError(
        `Declared config destination must be a file: ${dest}`,
      );
    }
    // An absent path and a dangling symlink both read as null: an absent
    // document rather than a read failure.
    const raw = await readTextIfPresent(dest);
    const host = raw === null ? {} : codec.load(raw, dest);
    const merged = mergeDeclared(host, declared, dest);
    // A pre-existing symlink is always materialized, even when the values
    // already match, because the symlink itself is the write-through hazard.
    if (stats?.isFile() && valueEqual(merged, host)) {
      return { ...base, status: 'unchanged' };
    }
    // The atomic rename replaces the destination path itself, so a symlink found
    // there becomes a regular file instead of being written through.
    await writeFileAtomically(dest, codec.serialize(merged));
    return { ...base, status: 'changed' };
  });
}

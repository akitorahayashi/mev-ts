import type { AssetRef } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import { lstatIfPresent, readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';
import type { Context } from '../../host/context';
import {
  declaredAssignments,
  mergeDeclared,
  valueEqual,
} from '../../host/declared-merge';
import { loadJsonObject, serializeJson } from '../../host/json';
import { editJsoncObject, loadJsoncObject } from '../../host/jsonc';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { loadToml, serializeToml } from '../../host/toml';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ActivationRunOptions,
} from './contract';
import { readDeployedManifest } from './manifest';
import { activationReport, guarded } from './reconcile';

type DeclaredKeysActivation = Extract<Activation, { kind: 'declaredKeys' }>;

type DocumentFormat = DeclaredKeysActivation['format'];

interface RenderedDocument {
  readonly merged: Record<string, unknown>;
  readonly host: Record<string, unknown>;
  readonly declared: Record<string, unknown>;
  /** The destination's current text, absent when there is no document yet. */
  readonly hostRaw: string | null;
  readonly source: string;
}

/**
 * Reading and writing one supported document format. The format is declared per
 * activation rather than derived from the asset's extension, so a destination
 * states what it is instead of resting on a filename convention. Whole-document
 * formats render by serializing `merged`; jsonc instead edits the host text in
 * place so the comments the format exists to allow survive the write.
 */
interface DocumentCodec {
  load(raw: string, source: string): Record<string, unknown>;
  render(document: RenderedDocument): string;
}

const codecs: Readonly<Record<DocumentFormat, DocumentCodec>> = {
  toml: { load: loadToml, render: ({ merged }) => serializeToml(merged) },
  json: { load: loadJsonObject, render: ({ merged }) => serializeJson(merged) },
  jsonc: {
    load: loadJsoncObject,
    render: ({ merged, host, declared, hostRaw, source }) =>
      hostRaw === null
        ? serializeJson(merged)
        : editJsoncObject(hostRaw, declaredAssignments(host, declared, source)),
  },
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
): ActivationDescription {
  return {
    subject: symbolic(activation.dest),
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
  options: ActivationRunOptions = { upgrade: false },
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
    const assignments = declaredAssignments(host, declared, dest);
    const merged = mergeDeclared(host, declared, dest);
    // A pre-existing symlink is always materialized, even when the values
    // already match, because the symlink itself is the write-through hazard.
    if (stats?.isFile() && valueEqual(merged, host) && !options.preserved) {
      return activationReport(base, [
        {
          label: base.subject,
          status: 'unchanged',
          details: ['declared keys already current'],
        },
      ]);
    }
    // The atomic rename replaces the destination path itself, so a symlink found
    // there becomes a regular file instead of being written through.
    await writeFileAtomically(
      dest,
      codec.render({ merged, host, declared, hostRaw: raw, source: dest }),
    );
    const details = [
      ...(options.preserved ? ['preserved application-managed state'] : []),
      ...assignments.map(([path]) => `updated ${path.join('.')}`),
      ...(raw === null ? ['created config file'] : []),
    ];
    return activationReport(base, [
      {
        label: base.subject,
        status: 'changed',
        details: details.length > 0 ? details : ['reconciled declared keys'],
      },
    ]);
  });
}

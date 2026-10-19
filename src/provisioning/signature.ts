import { createHash } from 'node:crypto';
import type { AssetSource } from '../assets/registry';
import type { PackageRequirement } from '../brew/package';
import type { Activation, CommandStep } from './activation/contract';
import type { Target } from './target';

/** One embedded role asset as the signature sees it. */
export interface AssetIntent {
  readonly key: string;
  readonly content: string;
  readonly executable: boolean;
}

interface SignatureInput {
  readonly target: string;
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly assets: readonly AssetIntent[];
  readonly activations: readonly unknown[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function packageIntent(packages: PackageRequirement): PackageRequirement {
  return {
    taps: sortedUnique(packages.taps),
    formulae: sortedUnique(packages.formulae),
    casks: sortedUnique(packages.casks),
  };
}

function stepIntent({ report: _report, ...intent }: CommandStep): unknown {
  return intent;
}

function activationIntent(activation: Activation): unknown {
  return canonicalize(
    activation.kind === 'command'
      ? { ...activation, steps: activation.steps.map(stepIntent) }
      : activation,
  );
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(canonicalize).filter((entry) => entry !== undefined);
  }
  const record = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = canonicalize(record[key]);
    if (entry !== undefined) canonical[key] = entry;
  }
  return canonical;
}

/**
 * Read every asset a role embeds. Exported so `scan.ts` can pass one read to
 * both the signature and the deployed-role drift check instead of reading the
 * same bytes twice per target.
 */
export async function readAssetIntents(
  role: string,
  assets: AssetSource,
): Promise<AssetIntent[]> {
  const keys = [...assets.keysByPrefix(`${role}/`)].sort();
  return Promise.all(
    keys.map(async (key) => ({
      key,
      content: await assets.read(key),
      executable: assets.isExecutable(key),
    })),
  );
}

export function signatureOf(
  target: Target,
  assets: readonly AssetIntent[],
): string {
  const input: SignatureInput = {
    target: target.name,
    role: target.role,
    packages: packageIntent(target.packages),
    assets,
    activations: target.activations.map(activationIntent),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  return `sha256:${digest}`;
}

export async function targetSignature(
  target: Target,
  assets: AssetSource,
): Promise<string> {
  return signatureOf(target, await readAssetIntents(target.role, assets));
}

import { createHash } from 'node:crypto';
import type { AssetSource } from '../assets/registry';
import type { PackageRequirement } from '../brew/package';
import type { Target } from './target';

interface AssetIntent {
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

/**
 * Canonicalize an activation (or any value reached from one) into a stable,
 * order-independent shape to hash. It recurses arrays and objects, sorts every
 * object's keys so construction order never shifts the digest, and drops
 * function-valued properties — a command read's `validate`/`derive` are runner
 * code, not declared intent. `HostPath` (`{ kind: 'home', rel }`) and `AssetRef`
 * (`{ key }`) are plain data, so their serialized form already carries their
 * identity; there is no per-kind projection. This replaces the parallel
 * re-declaration of the `Activation` contract, so a new kind or field needs no
 * mirror here.
 */
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

async function assetIntents(
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

/** Hash the user-visible desired state of one target, excluding runner code. */
export async function targetSignature(
  target: Target,
  assets: AssetSource,
): Promise<string> {
  const input: SignatureInput = {
    target: target.name,
    role: target.role,
    packages: packageIntent(target.packages),
    assets: await assetIntents(target.role, assets),
    activations: target.activations.map(canonicalize),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  return `sha256:${digest}`;
}

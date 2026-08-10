import type { AssetSource } from '../assets/registry';
import { errorMessage, ProvisioningError } from '../errors';
import type { Activation } from './activation/contract';
import { handlerFor } from './activation/kinds';
import { allTargets } from './registry';
import type { Target } from './target';

async function runCheck(
  key: string,
  parse:
    | ((raw: string, key: string, assets: AssetSource) => void | Promise<void>)
    | undefined,
  assets: AssetSource,
): Promise<void> {
  try {
    const raw = await assets.read(key);
    await parse?.(raw, key, assets);
  } catch (error) {
    throw new ProvisioningError(
      `Embedded asset preflight failed for ${key}: ${errorMessage(error)}`,
    );
  }
}

async function validateActivation(
  activation: Activation,
  assets: AssetSource,
): Promise<void> {
  const checks = handlerFor(activation).assetChecks?.(activation, assets) ?? [];
  for (const check of checks) {
    await runCheck(check.key, check.parse, assets);
  }
}

/**
 * Parse every config asset each target declares, so a manifest that no parser
 * accepts fails the build rather than a provisioning run. Each kind names its
 * own checks, and a manifest-backed kind derives them from the same parse
 * function its runner uses, so build validation cannot diverge from runtime
 * parsing. The gate is build-time only: `scripts/validate-assets.ts` invokes it
 * from the `precheck`/`pretypecheck` hooks and `build-bundle.ts` re-runs it
 * before every compile. `runMake` never calls it — a shipped binary's assets are
 * already validated.
 */
export async function validateEmbeddedAssets(
  assets: AssetSource,
  targets: readonly Target[] = allTargets(),
): Promise<void> {
  for (const target of targets) {
    for (const activation of target.activations) {
      await validateActivation(activation, assets);
    }
  }
}

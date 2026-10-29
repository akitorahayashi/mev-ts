import type { AssetSource } from '../assets/registry';
import { manifestName, parseManifest } from '../brew/manifest';
import {
  mergePackages,
  type PackageRequirement,
  packages,
} from '../brew/package';
import { resolveTarget } from './registry';
import type { Target } from './target';

/** A selected target with the Homebrew requirements its role's Brewfile declares. */
export interface PlannedTarget extends Target {
  readonly packages: PackageRequirement;
}

/**
 * A selection resolved into ordered work for each phase. `groups` carries the
 * selected targets themselves rather than their names: everything the activation
 * phase needs — role, packages, activations — already lives on a planned target,
 * and flattening to a name only forces the run to look it up again.
 */
export interface MakePlan {
  readonly targetNames: readonly string[];
  readonly roles: readonly string[];
  readonly packages: PackageRequirement;
  readonly groups: readonly PlannedTarget[];
}

async function rolePackages(
  role: string,
  assets: AssetSource,
): Promise<PackageRequirement> {
  const key = `${role}/${manifestName}`;
  if (!assets.keysByPrefix(key).includes(key)) return packages();
  return parseManifest(await assets.read(key), key);
}

/**
 * Resolve selectors into a plan. Targets are deduped so a target named by two
 * selectors contributes once, while target attribution is preserved per group.
 * Brewfiles are parsed here, before any provisioning state changes, so a
 * malformed declaration fails the run up front.
 */
export async function planMake(
  selectors: readonly string[],
  assets: AssetSource,
): Promise<MakePlan> {
  const seen = new Set<string>();
  const chosen: Target[] = [];
  for (const selector of selectors) {
    const t = resolveTarget(selector);
    if (!seen.has(t.name)) {
      seen.add(t.name);
      chosen.push(t);
    }
  }

  const roles: string[] = [];
  const roleSeen = new Set<string>();
  for (const t of chosen) {
    if (!roleSeen.has(t.role)) {
      roleSeen.add(t.role);
      roles.push(t.role);
    }
  }

  const groups = await Promise.all(
    chosen.map(async (t) => ({
      ...t,
      packages: await rolePackages(t.role, assets),
    })),
  );

  return {
    targetNames: chosen.map((t) => t.name),
    roles,
    packages: mergePackages(groups.map((group) => group.packages)),
    groups,
  };
}

import { mergePackages, type PackageRequirement } from '../brew/package';
import type { Activation } from './activation';
import { resolveTarget } from './registry';
import type { Target } from './target';

/** Activations contributed by one selected target, kept attributed to its name. */
export interface ActivationGroup {
  readonly targetName: string;
  readonly role: string;
  readonly packages: PackageRequirement;
  readonly activations: readonly Activation[];
}

/** A selection resolved into ordered work for each phase. */
export interface MakePlan {
  readonly targetNames: readonly string[];
  readonly roles: readonly string[];
  readonly packages: PackageRequirement;
  readonly groups: readonly ActivationGroup[];
}

/**
 * Resolve selectors into a plan. Targets are deduped so a target named by two
 * selectors contributes once, while target attribution is preserved per group.
 */
export function planMake(selectors: readonly string[]): MakePlan {
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

  return {
    targetNames: chosen.map((t) => t.name),
    roles,
    packages: mergePackages(chosen.map((t) => t.packages)),
    groups: chosen.map((t) => ({
      targetName: t.name,
      role: t.role,
      packages: t.packages,
      activations: t.activations,
    })),
  };
}

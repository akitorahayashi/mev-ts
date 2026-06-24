import { mergePackages, type PackageRequirement } from './package';
import { resolveTarget } from './registry';
import type { Activation, Target } from './target';

/** Activations contributed by one selected target, kept attributed to its tag. */
export interface ActivationGroup {
  readonly tag: string;
  readonly role: string;
  readonly activations: readonly Activation[];
}

/** A selection resolved into ordered work for each phase. */
export interface MakePlan {
  readonly tags: readonly string[];
  readonly roles: readonly string[];
  readonly packages: PackageRequirement;
  readonly groups: readonly ActivationGroup[];
}

/**
 * Resolve selectors (tags or aliases) into a plan. Targets are deduped so a
 * target named by two selectors contributes once, while tag attribution is
 * preserved per group so the execution log can stay grouped by tag.
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
    tags: chosen.map((t) => t.name),
    roles,
    packages: mergePackages(chosen.map((t) => t.packages)),
    groups: chosen.map((t) => ({
      tag: t.name,
      role: t.role,
      activations: t.activations,
    })),
  };
}

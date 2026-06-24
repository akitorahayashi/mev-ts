/**
 * Homebrew package requirements declared by a target. Taps, formulae, and casks
 * are collected and deduped across the selected targets before the install
 * phase runs them as a single batch.
 */
export interface PackageRequirement {
  readonly taps: readonly string[];
  readonly formulae: readonly string[];
  readonly casks: readonly string[];
}

export interface PackageInput {
  readonly taps?: readonly string[];
  readonly formulae?: readonly string[];
  readonly casks?: readonly string[];
}

export function packages(input: PackageInput = {}): PackageRequirement {
  return {
    taps: input.taps ?? [],
    formulae: input.formulae ?? [],
    casks: input.casks ?? [],
  };
}

function dedup(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const value of list) {
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

/** Merge requirements across targets, deduping while preserving first-seen order. */
export function mergePackages(
  reqs: readonly PackageRequirement[],
): PackageRequirement {
  return {
    taps: dedup(reqs.map((r) => r.taps)),
    formulae: dedup(reqs.map((r) => r.formulae)),
    casks: dedup(reqs.map((r) => r.casks)),
  };
}

export type PackageKind = 'tap' | 'formula' | 'cask';

export interface PackageToken {
  readonly kind: PackageKind;
  readonly name: string;
}

/** Flatten a requirement into install-ordered tokens: taps, formulae, casks. */
export function tokens(req: PackageRequirement): PackageToken[] {
  return [
    ...req.taps.map((name) => ({ kind: 'tap' as const, name })),
    ...req.formulae.map((name) => ({ kind: 'formula' as const, name })),
    ...req.casks.map((name) => ({ kind: 'cask' as const, name })),
  ];
}

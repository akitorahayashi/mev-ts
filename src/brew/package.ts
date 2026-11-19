import { ProvisioningError } from '../errors';

export type PackageKind = 'formula' | 'cask';

export interface PackageSet {
  readonly formulae: readonly string[];
  readonly casks: readonly string[];
}

/**
 * Homebrew packages declared by a target: the ones it needs installed and the
 * ones it explicitly removes. Requirements are merged and deduped across the
 * selected targets before the package phase runs them as a single batch.
 */
export interface PackageRequirement {
  readonly install: PackageSet;
  readonly uninstall: PackageSet;
}

export interface PackageToken {
  readonly kind: PackageKind;
  readonly name: string;
}

export const emptyPackageSet: PackageSet = { formulae: [], casks: [] };

export const noPackages: PackageRequirement = {
  install: emptyPackageSet,
  uninstall: emptyPackageSet,
};

function dedup(lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

function mergeSets(sets: readonly PackageSet[]): PackageSet {
  return {
    formulae: dedup(sets.map((set) => set.formulae)),
    casks: dedup(sets.map((set) => set.casks)),
  };
}

/**
 * A name one target installs and another removes would flip on every run that
 * selects them separately, so the conflict is refused rather than resolved by
 * phase order.
 */
export function mergePackages(
  reqs: readonly PackageRequirement[],
): PackageRequirement {
  const install = mergeSets(reqs.map((req) => req.install));
  const uninstall = mergeSets(reqs.map((req) => req.uninstall));
  const installed = new Set(
    tokens(install).map((token) => `${token.kind} ${token.name}`),
  );
  const conflict = tokens(uninstall).find((token) =>
    installed.has(`${token.kind} ${token.name}`),
  );
  if (conflict) {
    throw new ProvisioningError(
      `Homebrew ${conflict.kind} '${conflict.name}' is declared for both install and uninstall.`,
    );
  }
  return { install, uninstall };
}

export function tokens(set: PackageSet): PackageToken[] {
  return [
    ...set.formulae.map((name) => ({ kind: 'formula' as const, name })),
    ...set.casks.map((name) => ({ kind: 'cask' as const, name })),
  ];
}

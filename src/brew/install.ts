import { errorMessage } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import {
  type KindInventory,
  loadInstalledVersions,
  loadInventory,
  type VersionInventory,
} from './inventory';
import {
  type PackageKind,
  type PackageSet,
  type PackageToken,
  tokens,
} from './package';

export type InstallAction = 'install' | 'upgrade';

export type InstallReport =
  | {
      readonly token: PackageToken;
      readonly status: 'installed' | 'present';
    }
  | {
      readonly token: PackageToken;
      readonly status: 'upgraded';
      readonly previousVersions: readonly string[];
      readonly versions: readonly string[];
    }
  | {
      readonly token: PackageToken;
      readonly status: 'upgrade-current';
      readonly versions: readonly string[];
    }
  | {
      readonly token: PackageToken;
      readonly status: 'failed';
      readonly error: string;
    };

export type InstallStatus = InstallReport['status'];

interface PendingUpgrade {
  readonly token: PackageToken;
  readonly status: 'upgrade-pending';
  readonly previousVersions: readonly string[];
}

export interface InstallOptions {
  readonly upgrade?: boolean;
  /** Fires only for tokens that actually reach an install or upgrade step. */
  onTokenStart?(token: PackageToken, action: InstallAction): void;
  /** Fires after each token's individual work; successful upgrades are version-verified later in a batch. */
  onTick?(token: PackageToken): void;
}

// Only missing names reach this step, so a plain install never upgrades an
// installed package outside `--upgrade`.
async function install(context: Context, token: PackageToken): Promise<void> {
  await runProcessStep(
    context.commands,
    'brew',
    ['install', `--${token.kind}`, token.name],
    `brew install failed for ${token.kind} ${token.name}`,
  );
}

async function upgrade(
  context: Context,
  kind: PackageKind,
  name: string,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'brew',
    ['upgrade', '--no-ask', `--${kind}`, name],
    `brew upgrade failed for ${name}`,
  );
}

type TrustErrors = Readonly<Record<PackageKind, ReadonlyMap<string, string>>>;

function isTapQualified(name: string): boolean {
  return name.split('/').length === 3;
}

/**
 * Homebrew refuses to load a formula or cask from a non-official tap until it
 * is trusted, and declaring it in a role manifest is that trust decision. Only
 * names that this run is about to load are trusted, so an all-present run stays
 * free of the Ruby startup `brew trust` costs.
 */
async function trustTapped(
  context: Context,
  names: Record<PackageKind, readonly string[]>,
): Promise<TrustErrors> {
  const errors = {
    formula: new Map<string, string>(),
    cask: new Map<string, string>(),
  };
  // Sequential and one name per call: every `brew trust` rewrites the shared
  // trust store, and Homebrew keeps the names it trusted before a failing one,
  // so only a per-name call attributes a failure to its own package.
  for (const kind of ['formula', 'cask'] as const) {
    for (const name of names[kind].filter(isTapQualified)) {
      try {
        await runProcessStep(
          context.commands,
          'brew',
          ['trust', `--${kind}`, name],
          `brew trust failed for ${kind} ${name}`,
        );
      } catch (error) {
        errors[kind].set(name, errorMessage(error));
      }
    }
  }
  return errors;
}

function namesToLoad(
  names: readonly string[],
  kindInventory: KindInventory,
  upgrade: boolean,
): string[] {
  if (!kindInventory.loaded) return [];
  return names.filter((name) => upgrade || !kindInventory.names.has(name));
}

async function installMissingPackage(
  token: PackageToken,
  context: Context,
  options: InstallOptions,
): Promise<InstallReport> {
  try {
    options.onTokenStart?.(token, 'install');
    await install(context, token);
    return { token, status: 'installed' };
  } catch (error) {
    return { token, status: 'failed', error: errorMessage(error) };
  }
}

function upgradeCandidates(
  set: PackageSet,
  inventory: Awaited<ReturnType<typeof loadInventory>>,
  trustErrors: TrustErrors,
  enabled: boolean,
): PackageSet {
  if (!enabled) return { formulae: [], casks: [] };
  // An untrusted name would fail the whole batched version probe.
  const installedCandidates = (
    names: readonly string[],
    kind: PackageKind,
  ): string[] => {
    const kindInventory = inventory[kind];
    return kindInventory.loaded
      ? names.filter(
          (name) =>
            kindInventory.names.has(name) && !trustErrors[kind].has(name),
        )
      : [];
  };
  return {
    formulae: installedCandidates(set.formulae, 'formula'),
    casks: installedCandidates(set.casks, 'cask'),
  };
}

function missingVersionError(
  phase: 'pre-upgrade' | 'post-upgrade',
  token: PackageToken,
): string {
  return `Homebrew ${phase} inventory did not report an installed version for ${token.kind} ${token.name}.`;
}

function probeFailure(
  phase: 'before' | 'after',
  token: PackageToken,
  error: string,
): InstallReport {
  return {
    token,
    status: 'failed',
    error: `Could not verify the installed version for ${token.kind} ${token.name} ${phase} upgrade: ${error}`,
  };
}

function sameVersions(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    before.length === after.length &&
    before.every((version, index) => version === after[index])
  );
}

async function upgradeInstalledPackage(
  token: PackageToken,
  before: VersionInventory,
  context: Context,
  options: InstallOptions,
): Promise<InstallReport | PendingUpgrade> {
  const versionInventory = before[token.kind];
  if (!versionInventory.loaded) {
    return probeFailure('before', token, versionInventory.error);
  }
  const versionError = versionInventory.errors.get(token.name);
  if (versionError) return probeFailure('before', token, versionError);
  const previousVersions = versionInventory.versions.get(token.name);
  if (!previousVersions || previousVersions.length === 0) {
    return {
      token,
      status: 'failed',
      error: missingVersionError('pre-upgrade', token),
    };
  }
  try {
    options.onTokenStart?.(token, 'upgrade');
    await upgrade(context, token.kind, token.name);
    return { token, status: 'upgrade-pending', previousVersions };
  } catch (error) {
    return { token, status: 'failed', error: errorMessage(error) };
  }
}

/**
 * Resolve every required package as a batch. Installed state is enumerated
 * once up front (see loadInventory), so present tokens resolve as in-memory
 * lookups. Missing tokens spawn `brew install`; explicit upgrade mode also runs
 * `brew upgrade` for installed formulae and casks. A tap-qualified name taps
 * its tap on install, and is trusted before anything loads it. The hooks drive
 * live progress labels.
 */
export async function installPackages(
  set: PackageSet,
  context: Context,
  options: InstallOptions = {},
): Promise<InstallReport[]> {
  const list = tokens(set);
  if (list.length === 0) return [];

  const inventory = await loadInventory(set, context);
  const upgrading = options.upgrade === true;
  const trustErrors = await trustTapped(context, {
    formula: namesToLoad(set.formulae, inventory.formula, upgrading),
    cask: namesToLoad(set.casks, inventory.cask, upgrading),
  });
  const before = await loadInstalledVersions(
    upgradeCandidates(set, inventory, trustErrors, upgrading),
    context,
  );

  const reports: Array<InstallReport | PendingUpgrade> = [];
  for (const token of list) {
    const installed = inventory[token.kind];
    const trustError = trustErrors[token.kind].get(token.name);
    let report: InstallReport | PendingUpgrade;
    if (!installed.loaded) {
      report = { token, status: 'failed', error: installed.error };
    } else if (trustError) {
      report = { token, status: 'failed', error: trustError };
    } else if (!installed.names.has(token.name)) {
      report = await installMissingPackage(token, context, options);
    } else if (!upgrading) {
      report = { token, status: 'present' };
    } else {
      report = await upgradeInstalledPackage(token, before, context, options);
    }
    reports.push(report);
    options.onTick?.(token);
  }

  const pending = reports.filter(
    (report): report is PendingUpgrade => report.status === 'upgrade-pending',
  );
  const after = await loadInstalledVersions(
    {
      formulae: pending
        .filter((report) => report.token.kind === 'formula')
        .map((report) => report.token.name),
      casks: pending
        .filter((report) => report.token.kind === 'cask')
        .map((report) => report.token.name),
    },
    context,
  );

  const settled = reports.map((report): InstallReport => {
    if (report.status !== 'upgrade-pending') return report;
    const versionInventory = after[report.token.kind];
    if (!versionInventory.loaded) {
      return probeFailure('after', report.token, versionInventory.error);
    }
    const versionError = versionInventory.errors.get(report.token.name);
    if (versionError) {
      return probeFailure('after', report.token, versionError);
    }
    const versions = versionInventory.versions.get(report.token.name);
    if (!versions || versions.length === 0) {
      return {
        token: report.token,
        status: 'failed',
        error: missingVersionError('post-upgrade', report.token),
      };
    }
    return sameVersions(report.previousVersions, versions)
      ? { token: report.token, status: 'upgrade-current', versions }
      : {
          token: report.token,
          status: 'upgraded',
          previousVersions: report.previousVersions,
          versions,
        };
  });
  return settled;
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { runWithCleanup } from '../host/cleanup-error';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import {
  type KindInventory,
  loadInstalledVersions,
  loadInventory,
} from './inventory';
import {
  type PackageRequirement,
  type PackageToken,
  tokens,
  type UpgradeablePackageKind,
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
  readonly token: PackageToken & { readonly kind: UpgradeablePackageKind };
  readonly status: 'upgrade-pending';
  readonly previousVersions: readonly string[];
}

export interface InstallOptions {
  readonly upgrade?: boolean;
  onStart?(total: number): void;
  /** Fires only for tokens that actually reach an install or upgrade step. */
  onTokenStart?(token: PackageToken, action: InstallAction): void;
  onTick?(token: PackageToken): void;
}

/**
 * Writes a single-entry Brewfile to a temporary path and passes it to the given
 * action. Homebrew Bundle treats already-installed entries as no-ops, so
 * `install` is idempotent.
 */
async function withBrewfile<T>(
  tmpRoot: string,
  line: string,
  action: (file: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpRoot, 'mev-brewfile-'));
  const file = join(dir, 'Brewfile');
  return runWithCleanup(
    async () => {
      await writeFile(file, `${line}\n`);
      return action(file);
    },
    () => rm(dir, { force: true, recursive: true }),
    `Failed to clean up Brewfile directory ${dir}.`,
  );
}

// Homebrew tap/formula/cask names use only these characters. The emit layer
// validates before interpolating a name into the Ruby-string Brewfile DSL, so a
// name containing `"`, a newline, or `#{}` cannot break out or inject a
// directive regardless of where the name originated.
const SAFE_TOKEN_NAME = /^[A-Za-z0-9._@/+-]+$/;

function brewfileLine(token: PackageToken): string {
  if (!SAFE_TOKEN_NAME.test(token.name)) {
    throw new ProvisioningError(
      `Refusing to emit unsafe Homebrew token name '${token.name}'; names may contain only letters, digits, and ._@/+- characters.`,
    );
  }
  if (token.kind === 'tap') return `tap "${token.name}"`;
  if (token.kind === 'cask') return `cask "${token.name}"`;
  return `brew "${token.name}"`;
}

async function install(
  context: Context,
  line: string,
  name: string,
): Promise<void> {
  await withBrewfile(context.tmpRoot, line, async (file) => {
    await runProcessStep(
      context.commands,
      'brew',
      ['bundle', 'install', '--no-upgrade', `--file=${file}`],
      `brew bundle install failed for ${name}`,
    );
  });
}

async function upgrade(
  context: Context,
  kind: UpgradeablePackageKind,
  name: string,
): Promise<void> {
  await runProcessStep(
    context.commands,
    'brew',
    ['upgrade', '--no-ask', `--${kind}`, name],
    `brew upgrade failed for ${name}`,
  );
}

async function installMissingPackage(
  token: PackageToken,
  context: Context,
  options: InstallOptions,
): Promise<InstallReport> {
  try {
    options.onTokenStart?.(token, 'install');
    await install(context, brewfileLine(token), token.name);
    return { token, status: 'installed' };
  } catch (error) {
    return { token, status: 'failed', error: errorMessage(error) };
  }
}

function upgradeCandidates(
  req: PackageRequirement,
  inventory: Awaited<ReturnType<typeof loadInventory>>,
  enabled: boolean,
): PackageRequirement {
  if (!enabled) return { taps: [], formulae: [], casks: [] };
  const installedCandidates = (
    names: readonly string[],
    kindInventory: KindInventory,
  ): string[] =>
    kindInventory.loaded
      ? names.filter((name) => kindInventory.names.has(name))
      : [];
  return {
    taps: [],
    formulae: installedCandidates(req.formulae, inventory.formula),
    casks: installedCandidates(req.casks, inventory.cask),
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

/**
 * Resolve every required package as a batch. Installed state is enumerated
 * once up front (see loadInventory), so present tokens resolve as in-memory
 * lookups. Missing tokens spawn `brew bundle install`; explicit upgrade mode
 * also runs `brew upgrade` for installed formulae and casks. Tokens run in
 * taps→formulae→casks order, so a missing tap is installed before the formulae
 * that resolve through it. The hooks drive live progress labels and count
 * completed tokens.
 */
export async function installPackages(
  req: PackageRequirement,
  context: Context,
  options: InstallOptions = {},
): Promise<InstallReport[]> {
  const list = tokens(req);
  options.onStart?.(list.length);
  if (list.length === 0) return [];

  const inventory = await loadInventory(req, context);
  const reports: Array<InstallReport | PendingUpgrade> = [];
  for (const token of list) {
    if (token.kind !== 'tap') continue;
    const report = !inventory.tap.loaded
      ? { token, status: 'failed' as const, error: inventory.tap.error }
      : inventory.tap.names.has(token.name)
        ? { token, status: 'present' as const }
        : await installMissingPackage(token, context, options);
    reports.push(report);
    options.onTick?.(token);
  }

  const before = await loadInstalledVersions(
    upgradeCandidates(req, inventory, options.upgrade === true),
    context,
  );

  for (const token of list) {
    if (token.kind === 'tap') continue;
    const installed = inventory[token.kind];
    let report: InstallReport | PendingUpgrade;
    if (!installed.loaded) {
      report = { token, status: 'failed', error: installed.error };
    } else {
      const isInstalled = installed.names.has(token.name);
      const isUpgrade = isInstalled && options.upgrade === true;
      if (isInstalled && !isUpgrade) {
        report = { token, status: 'present' };
      } else if (isUpgrade) {
        const upgradeToken: PendingUpgrade['token'] = {
          kind: token.kind,
          name: token.name,
        };
        const versionInventory = before[upgradeToken.kind];
        if (!versionInventory.loaded) {
          report = probeFailure('before', upgradeToken, versionInventory.error);
        } else {
          const versionError = versionInventory.errors.get(upgradeToken.name);
          const previousVersions = versionInventory.versions.get(
            upgradeToken.name,
          );
          if (versionError) {
            report = probeFailure('before', upgradeToken, versionError);
          } else if (!previousVersions || previousVersions.length === 0) {
            report = {
              token: upgradeToken,
              status: 'failed',
              error: missingVersionError('pre-upgrade', upgradeToken),
            };
          } else {
            try {
              options.onTokenStart?.(upgradeToken, 'upgrade');
              await upgrade(context, upgradeToken.kind, upgradeToken.name);
              report = {
                token: upgradeToken,
                status: 'upgrade-pending',
                previousVersions,
              };
            } catch (error) {
              report = {
                token: upgradeToken,
                status: 'failed',
                error: errorMessage(error),
              };
            }
          }
        }
      } else {
        report = await installMissingPackage(token, context, options);
      }
    }
    reports.push(report);
    options.onTick?.(token);
  }

  const pending = reports.filter(
    (report): report is PendingUpgrade => report.status === 'upgrade-pending',
  );
  const after = await loadInstalledVersions(
    {
      taps: [],
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

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { runWithCleanup } from '../host/cleanup-error';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { loadInventory } from './inventory';
import {
  type PackageKind,
  type PackageRequirement,
  type PackageToken,
  tokens,
} from './package';

export type InstallStatus = 'installed' | 'present' | 'failed';

export type InstallAction = 'install' | 'upgrade';

type UpgradeablePackageKind = Exclude<PackageKind, 'tap'>;

export interface InstallReport {
  readonly token: PackageToken;
  readonly status: InstallStatus;
  readonly error?: string;
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

  const reports: InstallReport[] = [];
  for (const token of list) {
    const installed = inventory[token.kind];
    let report: InstallReport;
    if (!installed.loaded) {
      report = { token, status: 'failed', error: installed.error };
    } else {
      const isInstalled = installed.names.has(token.name);
      const isUpgrade =
        isInstalled && options.upgrade === true && token.kind !== 'tap';
      if (isInstalled && !isUpgrade) {
        report = { token, status: 'present' };
      } else {
        try {
          const action: InstallAction = isUpgrade ? 'upgrade' : 'install';
          options.onTokenStart?.(token, action);
          if (isUpgrade) {
            await upgrade(context, token.kind, token.name);
          } else {
            await install(context, brewfileLine(token), token.name);
          }
          report = {
            token,
            status: action === 'install' ? 'installed' : 'present',
          };
        } catch (error) {
          report = {
            token,
            status: 'failed',
            error: errorMessage(error),
          };
        }
      }
    }
    reports.push(report);
    options.onTick?.(token);
  }
  return reports;
}

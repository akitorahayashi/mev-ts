import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { throwWithCleanupError } from '../host/cleanup-error';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import {
  type PackageRequirement,
  type PackageToken,
  tokens,
} from '../provisioning/package';
import { loadInventory } from './inventory';

const noFailure = Symbol('noFailure');

export type InstallStatus = 'installed' | 'present' | 'failed';

export interface InstallReport {
  readonly token: PackageToken;
  readonly status: InstallStatus;
  readonly error?: string;
}

export interface InstallHooks {
  onStart?(total: number): void;
  /** Fires only for tokens that actually reach the install step. */
  onTokenStart?(token: PackageToken): void;
  onTick?(token: PackageToken): void;
}

/**
 * Writes a single-entry Brewfile to a temporary path and passes it to the given
 * action. Homebrew Bundle treats already-installed entries as no-ops, so
 * `install` is idempotent.
 */
async function withBrewfile<T>(
  line: string,
  action: (file: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mev-brewfile-'));
  const file = join(dir, 'Brewfile');
  let primary: unknown = noFailure;
  let result: T | undefined;
  try {
    await writeFile(file, `${line}\n`);
    result = await action(file);
  } catch (error) {
    primary = error;
  }

  try {
    await rm(dir, { force: true, recursive: true });
  } catch (cleanup) {
    if (primary !== noFailure) {
      throwWithCleanupError(
        primary,
        cleanup,
        `Failed to clean up Brewfile directory ${dir}.`,
      );
    }
    throw cleanup;
  }
  if (primary !== noFailure) throw primary;
  return result as T;
}

function brewfileLine(token: PackageToken): string {
  if (token.kind === 'tap') return `tap "${token.name}"`;
  if (token.kind === 'cask') return `cask "${token.name}"`;
  return `brew "${token.name}"`;
}

async function install(
  context: Context,
  line: string,
  name: string,
): Promise<void> {
  await withBrewfile(line, async (file) => {
    const result = await context.commands.run('brew', [
      'bundle',
      'install',
      '--no-upgrade',
      `--file=${file}`,
    ]);
    if (result.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure(`brew bundle install failed for ${name}`, result),
      );
    }
  });
}

/**
 * Resolve every required package as a batch. Installed state is enumerated
 * once up front (see loadInventory), so present tokens resolve as in-memory
 * lookups and only missing tokens spawn `brew bundle install`. Tokens run in
 * taps→formulae→casks order, so a missing tap is installed before the
 * formulae that resolve through it. The hooks drive live progress labels and
 * count completed tokens.
 */
export async function installPackages(
  req: PackageRequirement,
  context: Context,
  hooks: InstallHooks = {},
): Promise<InstallReport[]> {
  const list = tokens(req);
  hooks.onStart?.(list.length);
  if (list.length === 0) return [];

  const inventory = await loadInventory(req, context);

  const reports: InstallReport[] = [];
  for (const token of list) {
    const installed = inventory[token.kind];
    let report: InstallReport;
    if (!installed.loaded) {
      report = { token, status: 'failed', error: installed.error };
    } else if (installed.names.has(token.name)) {
      report = { token, status: 'present' };
    } else {
      try {
        hooks.onTokenStart?.(token);
        await install(context, brewfileLine(token), token.name);
        report = { token, status: 'installed' };
      } catch (error) {
        report = {
          token,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    reports.push(report);
    hooks.onTick?.(token);
  }
  return reports;
}

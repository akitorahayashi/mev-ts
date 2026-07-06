import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { runWithCleanup } from '../host/cleanup-error';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import {
  type PackageRequirement,
  type PackageToken,
  tokens,
} from '../provisioning/package';

export type InstallStatus = 'installed' | 'present' | 'failed';
export type InstallStage = 'checking' | 'installing';

export interface InstallReport {
  readonly token: PackageToken;
  readonly status: InstallStatus;
  readonly error?: string;
}

export interface InstallHooks {
  onStart?(total: number): void;
  onTokenStart?(token: PackageToken, stage: InstallStage): void;
  onTick?(token: PackageToken): void;
}

/**
 * Writes a single-entry Brewfile to a temporary path and passes it to the given
 * action. Homebrew Bundle treats already-installed entries as no-ops, so
 * `check` reports desired state and `install` is idempotent.
 */
async function withBrewfile<T>(
  line: string,
  action: (file: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mev-brewfile-'));
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

function brewfileLine(token: PackageToken): string {
  if (token.kind === 'tap') return `tap "${token.name}"`;
  if (token.kind === 'cask') return `cask "${token.name}"`;
  return `brew "${token.name}"`;
}

function isPresent(context: Context, line: string): Promise<boolean> {
  return withBrewfile(line, async (file) => {
    const result = await context.commands.run('brew', [
      'bundle',
      'check',
      `--file=${file}`,
    ]);
    return result.code === 0;
  });
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
 * Resolve every required package as a batch. Missing tokens are installed and
 * already-installed entries are reported as present. The hooks drive live
 * progress labels and count completed tokens.
 */
export async function installPackages(
  req: PackageRequirement,
  context: Context,
  hooks: InstallHooks = {},
): Promise<InstallReport[]> {
  const list = tokens(req);
  hooks.onStart?.(list.length);

  const reports: InstallReport[] = [];
  for (const token of list) {
    const line = brewfileLine(token);
    let report: InstallReport;
    try {
      hooks.onTokenStart?.(token, 'checking');
      if (await isPresent(context, line)) {
        report = { token, status: 'present' };
      } else {
        hooks.onTokenStart?.(token, 'installing');
        await install(context, line, token.name);
        report = { token, status: 'installed' };
      }
    } catch (error) {
      report = {
        token,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    reports.push(report);
    hooks.onTick?.(token);
  }
  return reports;
}

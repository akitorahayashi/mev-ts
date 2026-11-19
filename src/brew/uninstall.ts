import { errorMessage } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { loadInventory } from './inventory';
import type { PackageSet, PackageToken } from './package';

export type UninstallReport =
  | {
      readonly token: PackageToken;
      readonly status: 'uninstalled' | 'absent';
    }
  | {
      readonly token: PackageToken;
      readonly status: 'failed';
      readonly error: string;
    };

export interface UninstallOptions {
  /** Fires only for tokens that are installed and reach the uninstall step. */
  onTokenStart?(token: PackageToken): void;
  onTick?(token: PackageToken): void;
}

// `--zap` also removes a cask's preferences and caches, so a removed app leaves
// nothing behind. Formulae are never forced past their dependents: Homebrew's
// refusal is reported rather than leaving a dependent broken.
function uninstallArgs(token: PackageToken): string[] {
  return token.kind === 'cask'
    ? ['uninstall', '--cask', '--zap', token.name]
    : ['uninstall', '--formula', token.name];
}

/**
 * Remove every listed package that is installed; absent ones are already in the
 * desired state. Casks go first because a cask may depend on a listed formula.
 */
export async function uninstallPackages(
  set: PackageSet,
  context: Context,
  options: UninstallOptions = {},
): Promise<UninstallReport[]> {
  const list: PackageToken[] = [
    ...set.casks.map((name) => ({ kind: 'cask' as const, name })),
    ...set.formulae.map((name) => ({ kind: 'formula' as const, name })),
  ];
  if (list.length === 0) return [];

  const inventory = await loadInventory(set, context);
  const reports: UninstallReport[] = [];
  for (const token of list) {
    const installed = inventory[token.kind];
    let report: UninstallReport;
    if (!installed.loaded) {
      report = { token, status: 'failed', error: installed.error };
    } else if (!installed.names.has(token.name)) {
      report = { token, status: 'absent' };
    } else {
      try {
        options.onTokenStart?.(token);
        await runProcessStep(
          context.commands,
          'brew',
          uninstallArgs(token),
          `brew uninstall failed for ${token.kind} ${token.name}`,
        );
        report = { token, status: 'uninstalled' };
      } catch (error) {
        report = { token, status: 'failed', error: errorMessage(error) };
      }
    }
    reports.push(report);
    options.onTick?.(token);
  }
  return reports;
}

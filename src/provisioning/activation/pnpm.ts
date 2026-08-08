import { errorMessage, ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import { add, remove } from '../../pnpm/command';
import { type PnpmRuntime, pnpmRuntime } from '../../pnpm/environment';
import { type InstalledPackage, listGlobal } from '../../pnpm/inventory';
import {
  type PnpmEntry,
  type PnpmPackage,
  parseManifest,
} from '../../pnpm/manifest';
import {
  installSpec,
  needsInstall,
  shouldUpgrade,
} from '../../pnpm/reconciliation';
import type { Activation } from './contract';
import { manifestKind, manifestSource } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type PnpmActivation = Extract<Activation, { kind: 'pnpm' }>;

export function applyPnpm(configKey: string): Activation {
  return { kind: 'pnpm', configKey };
}

function installStep(
  pkg: PnpmPackage,
  installed: InstalledPackage | undefined,
  context: Context,
  runtime: PnpmRuntime,
  update: boolean,
): ReconcileStep {
  return {
    async run() {
      if (needsInstall(pkg, installed)) {
        await add(context, runtime, installSpec(pkg));
        return { key: pkg.name, value: 'installed', status: 'changed' };
      }
      if (installed && shouldUpgrade(pkg, installed, update)) {
        await add(context, runtime, installSpec(pkg));
        // Classification diffs the pre/post inventory versions: `pnpm add -g`
        // reports success identically whether it changed anything or not.
        const refreshed = (await listGlobal(context, runtime)).get(pkg.name);
        if (!refreshed) {
          throw new ProvisioningError(
            `pnpm add -g for ${pkg.name} left the package absent from the global inventory.`,
          );
        }
        if (refreshed.version !== installed.version) {
          return {
            key: pkg.name,
            value: `upgraded to ${refreshed.version}`,
            status: 'changed',
          };
        }
      }
      return { key: pkg.name, value: 'up to date', status: 'unchanged' };
    },
    onError(error) {
      return {
        key: pkg.name,
        value: 'install',
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

// Removal is guarded by the inventory because `pnpm remove -g` fails on a
// package that is not installed — the guard is what keeps repeat runs
// idempotent.
function uninstallStep(
  name: string,
  installed: InstalledPackage | undefined,
  context: Context,
  runtime: PnpmRuntime,
): ReconcileStep {
  return {
    async run() {
      if (!installed) {
        return { key: name, value: 'already absent', status: 'unchanged' };
      }
      await remove(context, runtime, name);
      return { key: name, value: 'uninstalled', status: 'changed' };
    },
    onError(error) {
      return {
        key: name,
        value: 'uninstall',
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

const pnpmKind = manifestKind<PnpmActivation, PnpmEntry>({
  parse: parseManifest,
  manifestLabel: 'pnpm global packages manifest',
  describe: (activation) => ({
    verb: 'apply',
    source: manifestSource(activation.configKey),
    dest: 'pnpm global packages',
  }),
  steps: async (entries, _activation, context, runOptions) => {
    const runtime = await pnpmRuntime(context);
    const installed = await listGlobal(context, runtime);
    // parseManifest orders removals ahead of packages, so mapping in manifest
    // order preserves the uninstall-before-install convention.
    return entries.map((entry) =>
      entry.action === 'uninstall'
        ? uninstallStep(entry.name, installed.get(entry.name), context, runtime)
        : installStep(
            entry.package,
            installed.get(entry.package.name),
            context,
            runtime,
            runOptions.update,
          ),
    );
  },
});

export const describePnpm = pnpmKind.describe;
export const pnpmConfigAssets = pnpmKind.configAssets;
export const runPnpm = pnpmKind.run;

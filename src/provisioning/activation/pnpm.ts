import { errorMessage, ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import { add, remove } from '../../pnpm/command';
import { type PnpmRuntime, pnpmRuntime } from '../../pnpm/environment';
import { type InstalledPackage, listGlobal } from '../../pnpm/inventory';
import {
  type PnpmEntry,
  type PnpmPackage,
  packageKey,
  parseManifest,
} from '../../pnpm/manifest';
import {
  installSpec,
  needsInstall,
  shouldUpgrade,
} from '../../pnpm/reconciliation';
import type { Activation } from './contract';
import { manifestKind } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type PnpmActivation = Extract<Activation, { kind: 'pnpm' }>;

export function applyPnpm(configKey: string): Activation {
  return { kind: 'pnpm', configKey };
}

function installStep(
  pkg: PnpmPackage,
  inventory: () => Promise<ReadonlyMap<string, InstalledPackage>>,
  context: Context,
  runtime: PnpmRuntime,
  upgrade: boolean,
): ReconcileStep {
  return {
    async run() {
      const installed = (await inventory()).get(packageKey(pkg.name));
      if (needsInstall(pkg, installed)) {
        await add(context, runtime, installSpec(pkg));
        return { key: pkg.name, value: 'installed', status: 'changed' };
      }
      if (installed && shouldUpgrade(pkg, installed, upgrade)) {
        await add(context, runtime, installSpec(pkg));
        // Classification diffs the pre/post inventory versions: `pnpm add -g`
        // reports success identically whether it changed anything or not.
        const refreshed = (await listGlobal(context, runtime)).get(
          packageKey(pkg.name),
        );
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

export const pnpmKind = manifestKind<PnpmActivation, PnpmEntry>({
  parse: parseManifest,
  manifestLabel: 'pnpm global packages manifest',
  describe: () => ({
    subject: 'pnpm global packages',
    unchangedCollection: 'pnpm global packages',
  }),
  steps: async (entries, _activation, context, runOptions) => {
    const runtime = await pnpmRuntime(context);
    const installed = await listGlobal(context, runtime);
    // pnpm removes at installation-group granularity, so a removal may sweep
    // packages beyond the named one. When any listed removal will actually
    // run, installs reconcile against a re-read inventory instead of the
    // pre-removal snapshot; a declared package a group removal swept away is
    // then seen as missing and reinstalled in the same run. Steps execute
    // serially and removals precede installs, so the lazy re-read happens
    // after every removal has finished.
    const willRemove = entries.some(
      (entry) => entry.action === 'uninstall' && installed.has(entry.name),
    );
    let refreshed: Promise<Map<string, InstalledPackage>> | undefined;
    const inventory = (): Promise<ReadonlyMap<string, InstalledPackage>> => {
      if (!willRemove) return Promise.resolve(installed);
      refreshed ??= listGlobal(context, runtime);
      return refreshed;
    };
    // parseManifest orders removals ahead of packages, so mapping in manifest
    // order preserves the uninstall-before-install convention.
    return entries.map((entry) =>
      entry.action === 'uninstall'
        ? uninstallStep(
            entry.name,
            installed.get(packageKey(entry.name)),
            context,
            runtime,
          )
        : installStep(
            entry.package,
            inventory,
            context,
            runtime,
            runOptions.upgrade,
          ),
    );
  },
});

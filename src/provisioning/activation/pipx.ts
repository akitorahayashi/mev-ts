import { errorMessage, ProvisioningError } from '../../errors';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import {
  inject,
  install,
  postInstall,
  uninstall,
  upgrade as upgradePackage,
} from '../../pipx/command';
import { brewEnv, localVenvs } from '../../pipx/environment';
import { type Installed, listInstalled } from '../../pipx/inventory';
import {
  normalizedPackageName,
  type PipxEntry,
  type PipxTool,
  parseManifest,
} from '../../pipx/manifest';
import {
  installSpec,
  needsReinstall,
  shouldInject,
  shouldPostInstall,
  shouldUpgrade,
} from '../../pipx/reconciliation';
import type { Activation } from './contract';
import { manifestKind } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type PipxActivation = Extract<Activation, { kind: 'pipx' }>;

export function applyPipx(configKey: string): Activation {
  return { kind: 'pipx', configKey };
}

// One step drives up to four sub-actions (uninstall, install, inject,
// post-install) for a tool, so a failure surfaces as a single line naming the
// sub-actions that had run before the error. This coarser granularity is
// accepted: the four are one logical "make this tool current" unit per item.
function pipxStep(
  tool: PipxTool,
  installed: Installed | undefined,
  context: Context,
  options: CommandOptions,
  venvs: string,
  upgrade: boolean,
): ReconcileStep {
  const actions: string[] = [];
  return {
    async run() {
      const reinstall = needsReinstall(tool, installed);
      if (reinstall && installed) {
        await uninstall(context, options, installed.name);
        actions.push('uninstalled');
      }
      let justInstalled = false;
      if (reinstall) {
        await install(context, options, installSpec(tool));
        justInstalled = true;
        actions.push('installed');
      }
      let justUpgraded = false;
      if (installed && shouldUpgrade(tool, installed, upgrade)) {
        await upgradePackage(context, options, tool.package);
        // Classification diffs the pre/post inventory versions instead of
        // pipx's machine-readable upgrade output, which only exists in recent
        // pipx releases that provisioning never guarantees (the install phase
        // runs `brew bundle install --no-upgrade`, so an older pipx stays).
        const refreshed = (await listInstalled(context, options)).get(
          normalizedPackageName(tool.package),
        );
        if (!refreshed) {
          throw new ProvisioningError(
            `pipx upgrade for ${tool.package} left the tool absent from the pipx inventory.`,
          );
        }
        if (refreshed.version !== installed.version) {
          justUpgraded = true;
          actions.push(`upgraded to ${refreshed.version}`);
        }
      }
      let justInjected = false;
      if (shouldInject(tool, installed, justInstalled)) {
        await inject(context, options, tool.package, tool.inject ?? []);
        justInjected = true;
        actions.push('injected');
      }
      if (
        tool.post_install &&
        shouldPostInstall(tool, justInstalled, justInjected, justUpgraded)
      ) {
        await postInstall(
          context,
          options,
          venvs,
          tool.package,
          tool.post_install,
        );
        actions.push('post-installed');
      }
      return {
        key: tool.package,
        value: actions.length > 0 ? actions.join(', ') : 'up to date',
        status: actions.length > 0 ? 'changed' : 'unchanged',
      };
    },
    onError(error) {
      return {
        key: tool.package,
        value: actions.join(', '),
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

// Removal is guarded by the inventory, so a name that is already absent
// reports unchanged instead of failing — repeat runs stay idempotent.
function pipxUninstallStep(
  pkg: string,
  installed: Installed | undefined,
  context: Context,
  options: CommandOptions,
): ReconcileStep {
  return {
    async run() {
      if (!installed) {
        return { key: pkg, value: 'already absent', status: 'unchanged' };
      }
      await uninstall(context, options, installed.name);
      return { key: pkg, value: 'uninstalled', status: 'changed' };
    },
    onError(error) {
      return {
        key: pkg,
        value: 'uninstall',
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export const pipxKind = manifestKind<PipxActivation, PipxEntry>({
  parse: parseManifest,
  manifestLabel: 'Pipx config file',
  describe: () => ({
    subject: 'Python tools',
    unchangedCollection: 'Python tools',
  }),
  steps: async (entries, _activation, context, runOptions) => {
    const options = await brewEnv(context);
    const installed = await listInstalled(context, options);
    const tools = entries.flatMap((entry) =>
      entry.action === 'install' ? [entry.tool] : [],
    );
    const venvs = tools.some((tool) => tool.post_install)
      ? await localVenvs(context, options)
      : '';
    // parseManifest orders removals ahead of tools, so mapping in manifest
    // order preserves the uninstall-before-install convention.
    return entries.map((entry) =>
      entry.action === 'uninstall'
        ? pipxUninstallStep(
            entry.package,
            installed.get(normalizedPackageName(entry.package)),
            context,
            options,
          )
        : pipxStep(
            entry.tool,
            installed.get(normalizedPackageName(entry.tool.package)),
            context,
            options,
            venvs,
            runOptions.upgrade,
          ),
    );
  },
});

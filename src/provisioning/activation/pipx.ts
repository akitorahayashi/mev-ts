import { errorMessage, ProvisioningError } from '../../errors';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import {
  inject,
  install,
  postInstall,
  uninstall,
  upgrade,
} from '../../pipx/command';
import { brewEnv, localVenvs } from '../../pipx/environment';
import { type Installed, listInstalled } from '../../pipx/inventory';
import { type PipxTool, parseTools } from '../../pipx/manifest';
import {
  installSpec,
  needsReinstall,
  shouldInject,
  shouldPostInstall,
  shouldUpgrade,
} from '../../pipx/reconciliation';
import type { Activation } from './contract';
import { manifestKind, manifestSource } from './manifest-kind';
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
  update: boolean,
): ReconcileStep {
  const actions: string[] = [];
  return {
    async run() {
      const reinstall = needsReinstall(tool, installed);
      if (reinstall && installed) {
        await uninstall(context, options, tool.package);
        actions.push('uninstalled');
      }
      let justInstalled = false;
      if (reinstall) {
        await install(context, options, installSpec(tool));
        justInstalled = true;
        actions.push('installed');
      }
      let justUpgraded = false;
      if (installed && shouldUpgrade(tool, installed, update)) {
        await upgrade(context, options, tool.package);
        // Classification diffs the pre/post inventory versions instead of
        // pipx's machine-readable upgrade output, which only exists in recent
        // pipx releases that provisioning never guarantees (the install phase
        // runs `brew bundle install --no-upgrade`, so an older pipx stays).
        const refreshed = (await listInstalled(context, options)).get(
          tool.package,
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

const pipxKind = manifestKind<PipxActivation, PipxTool>({
  parse: parseTools,
  manifestLabel: 'Pipx config file',
  describe: (activation) => ({
    verb: 'apply',
    source: manifestSource(activation.configKey),
    dest: 'python tools',
  }),
  steps: async (tools, _activation, context, runOptions) => {
    const options = await brewEnv(context);
    const installed = await listInstalled(context, options);
    const venvs = tools.some((tool) => tool.post_install)
      ? await localVenvs(context, options)
      : '';
    return tools.map((tool) =>
      pipxStep(
        tool,
        installed.get(tool.package),
        context,
        options,
        venvs,
        runOptions.update,
      ),
    );
  },
});

export const describePipx = pipxKind.describe;
export const pipxConfigAssets = pipxKind.configAssets;
export const runPipx = pipxKind.run;

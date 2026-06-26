import { basename, extname } from 'node:path';
import type { CommandOptions } from '../../host/command';
import type { Context } from '../../host/context';
import {
  brewEnv,
  type Installed,
  inject,
  install,
  installSpec,
  listInstalled,
  localVenvs,
  needsReinstall,
  type PipxTool,
  parseTools,
  postInstall,
  shouldInject,
  shouldPostInstall,
  uninstall,
} from '../../pipx/install';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

type PipxActivation = Extract<Activation, { kind: 'pipx' }>;

export function applyPipx(configKey: string): Activation {
  return { kind: 'pipx', configKey };
}

export function describePipx(activation: PipxActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: 'python tools',
  };
}

function pipxStep(
  tool: PipxTool,
  installed: Installed | undefined,
  context: Context,
  options: CommandOptions,
  venvs: string,
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
      let justInjected = false;
      if (shouldInject(tool, installed, justInstalled)) {
        await inject(context, options, tool.package, tool.inject ?? []);
        justInjected = true;
        actions.push('injected');
      }
      if (
        tool.post_install &&
        shouldPostInstall(tool, justInstalled, justInjected)
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

export function runPipx(
  activation: PipxActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  return reconcile(describePipx(activation), plan, {
    declare: () =>
      readDeployedManifest(
        activation.configKey,
        context.home,
        parseTools,
        'Pipx config file',
      ),
    steps: async (tools) => {
      const options = await brewEnv(context);
      const installed = await listInstalled(context, options);
      const venvs = tools.some((tool) => tool.post_install)
        ? await localVenvs(context, options)
        : '';
      return tools.map((tool) =>
        pipxStep(tool, installed.get(tool.package), context, options, venvs),
      );
    },
  });
}

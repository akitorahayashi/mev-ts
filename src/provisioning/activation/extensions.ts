import {
  installExtension,
  listInstalled,
  parseExtensions,
} from '../../editor/extension';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import type { Activation, ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

type ExtensionsActivation = Extract<Activation, { kind: 'editorExtensions' }>;

export function installExtensions(
  command: string,
  configKey: string,
): Activation {
  return { kind: 'editorExtensions', command, configKey };
}

export function describeExtensions(
  activation: ExtensionsActivation,
): Described {
  return { verb: 'apply', source: activation.command, dest: 'extensions' };
}

function extensionStep(
  extension: string,
  installed: ReadonlySet<string>,
  command: string,
  context: Context,
): ReconcileStep {
  return {
    async run() {
      if (installed.has(extension.toLowerCase())) {
        return { key: extension, value: 'up to date', status: 'unchanged' };
      }
      await installExtension(command, extension, context);
      return { key: extension, value: 'installed', status: 'changed' };
    },
    onError(error) {
      return {
        key: extension,
        value: 'install',
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export function runExtensions(
  activation: ExtensionsActivation,
  context: Context,
): Promise<ActivationReport> {
  return reconcile(describeExtensions(activation), {
    declare: () =>
      readDeployedManifest(
        activation.configKey,
        context.home,
        parseExtensions,
        'Extensions manifest',
      ),
    steps: async (desired) => {
      const installed = await listInstalled(activation.command, context);
      return desired.map((extension) =>
        extensionStep(extension, installed, activation.command, context),
      );
    },
  });
}

import {
  installExtension,
  listInstalled,
  parseExtensions,
} from '../../editor/extension';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { manifestKind } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type ExtensionsActivation = Extract<Activation, { kind: 'editorExtensions' }>;

export function installExtensions(
  command: string,
  configKey: string,
): Activation {
  return { kind: 'editorExtensions', command, configKey };
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

const extensionsKind = manifestKind<ExtensionsActivation, string>({
  parse: parseExtensions,
  manifestLabel: 'Extensions manifest',
  // Source is the editor CLI, not the manifest basename, so two editors that
  // share a manifest name still render distinctly.
  describe: (activation) => ({
    verb: 'apply',
    source: activation.command,
    dest: 'extensions',
  }),
  steps: async (desired, activation, context) => {
    const installed = await listInstalled(activation.command, context);
    return desired.map((extension) =>
      extensionStep(extension, installed, activation.command, context),
    );
  },
});

export const describeExtensions = extensionsKind.describe;
export const extensionsConfigAssets = extensionsKind.configAssets;
export const runExtensions = extensionsKind.run;

import {
  type Association,
  currentApp,
  parseAssociations,
  setApp,
} from '../../duti/association';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { manifestKind, manifestSource } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type DutiActivation = Extract<Activation, { kind: 'duti' }>;

export function applyDuti(configKey: string): Activation {
  return { kind: 'duti', configKey };
}

function dutiStep(
  { bundleId, extension }: Association,
  context: Context,
): ReconcileStep {
  return {
    async run() {
      if ((await currentApp(extension, context)) === bundleId) {
        return { key: extension, value: bundleId, status: 'unchanged' };
      }
      await setApp(bundleId, extension, context);
      return { key: extension, value: bundleId, status: 'changed' };
    },
    onError(error) {
      return {
        key: extension,
        value: bundleId,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export const dutiKind = manifestKind<DutiActivation, Association>({
  parse: parseAssociations,
  manifestLabel: 'Duti config file',
  describe: (activation) => ({
    verb: 'apply',
    source: manifestSource(activation.configKey),
    dest: 'file associations',
  }),
  // Extensions are unique (enforced at parse time), so the per-extension duti
  // probes are independent subprocess spawns and run concurrently.
  concurrency: 4,
  steps: async (entries, _activation, context) =>
    entries.map((entry) => dutiStep(entry, context)),
});

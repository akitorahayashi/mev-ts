import {
  type Association,
  currentApp,
  parseAssociations,
  setApp,
} from '../../duti/association';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { manifestKind } from './manifest-kind';
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
      const current = await currentApp(extension, context);
      const label = `file association .${extension}`;
      if (current === bundleId) {
        return {
          key: label,
          value: `current: ${bundleId}`,
          status: 'unchanged',
        };
      }
      await setApp(bundleId, extension, context);
      return {
        key: label,
        value: `${current ?? 'not set'} -> ${bundleId}`,
        status: 'changed',
      };
    },
    onError(error) {
      return {
        key: `file association .${extension}`,
        value: `wanted: ${bundleId}`,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export const dutiKind = manifestKind<DutiActivation, Association>({
  parse: parseAssociations,
  manifestLabel: 'Duti config file',
  describe: () => ({
    subject: 'file associations',
    unchangedCollection: 'file associations',
  }),
  // Extensions are unique (enforced at parse time), so the per-extension duti
  // probes are independent subprocess spawns and run concurrently.
  concurrency: 4,
  steps: async (entries, _activation, context) =>
    entries.map((entry) => dutiStep(entry, context)),
});

import { basename, extname } from 'node:path';
import {
  type Association,
  currentApp,
  parseAssociations,
  setApp,
} from '../../duti/association';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

type DutiActivation = Extract<Activation, { kind: 'duti' }>;

export function applyDuti(configKey: string): Activation {
  return { kind: 'duti', configKey };
}

export function describeDuti(activation: DutiActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: 'file associations',
  };
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

export function runDuti(
  activation: DutiActivation,
  context: Context,
): Promise<ActivationReport> {
  return reconcile(describeDuti(activation), {
    declare: () =>
      readDeployedManifest(
        activation.configKey,
        context.home,
        parseAssociations,
        'Duti config file',
      ),
    steps: async (entries) => entries.map((entry) => dutiStep(entry, context)),
  });
}

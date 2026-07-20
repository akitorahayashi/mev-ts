import { basename, extname } from 'node:path';
import {
  defaultsArg,
  defaultsTypeMatches,
  defaultsValueMatches,
} from '../../defaults/command';
import { type DefaultsEntry, parseDefaults } from '../../defaults/manifest';
import { errorMessage } from '../../errors';
import { formatCommandFailure } from '../../host/command';
import type { Context } from '../../host/context';
import type { Activation, ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

type DefaultsActivation = Extract<Activation, { kind: 'defaults' }>;

export function applyDefaults(configKey: string): Activation {
  return { kind: 'defaults', configKey };
}

export function describeDefaults(activation: DefaultsActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: 'macOS defaults',
  };
}

function defaultsStep(entry: DefaultsEntry, context: Context): ReconcileStep {
  const displayValue = defaultsArg(entry.type, entry.value, context.home);
  const writeArgs = [
    'write',
    entry.domain,
    entry.key,
    `-${entry.type}`,
    displayValue,
  ];
  return {
    async run() {
      const current = await context.commands.run('defaults', [
        'read',
        entry.domain,
        entry.key,
      ]);
      const currentType =
        current.code === 0
          ? await context.commands.run('defaults', [
              'read-type',
              entry.domain,
              entry.key,
            ])
          : null;
      if (
        current.code === 0 &&
        currentType?.code === 0 &&
        defaultsTypeMatches(entry.type, currentType.stdout) &&
        defaultsValueMatches(entry.type, displayValue, current.stdout)
      ) {
        return { key: entry.key, value: displayValue, status: 'unchanged' };
      }
      const result = await context.commands.run('defaults', writeArgs);
      if (result.code !== 0) {
        return {
          key: entry.key,
          value: displayValue,
          status: 'failed',
          error: formatCommandFailure(
            `defaults write failed for ${entry.domain} ${entry.key}`,
            result,
          ),
        };
      }
      return { key: entry.key, value: displayValue, status: 'changed' };
    },
    onError(error) {
      return {
        key: entry.key,
        value: displayValue,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export function runDefaults(
  activation: DefaultsActivation,
  context: Context,
): Promise<ActivationReport> {
  return reconcile(describeDefaults(activation), {
    declare: () =>
      readDeployedManifest(
        activation.configKey,
        context.home,
        parseDefaults,
        'Defaults config file',
      ),
    steps: async (entries) =>
      entries.map((entry) => defaultsStep(entry, context)),
  });
}

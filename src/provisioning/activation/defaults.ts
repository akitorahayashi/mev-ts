import type { AssetSource } from '../../assets/registry';
import {
  defaultsArg,
  defaultsTypeMatches,
  defaultsValueMatches,
} from '../../defaults/command';
import { type DefaultsEntry, parseDefaults } from '../../defaults/manifest';
import { errorMessage } from '../../errors';
import { formatCommandFailure } from '../../host/command';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { manifestKind } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type DefaultsActivation = Extract<Activation, { kind: 'defaults' }>;

export function applyDefaults(configKey: string): Activation {
  return { kind: 'defaults', configKey };
}

/**
 * Expand every embedded config asset under `prefix` into a `defaults` activation,
 * deriving the set from the asset registry (as `linkTree` derives its links from
 * the asset set) so a manifest added under the prefix is picked up without
 * editing the target.
 */
export function applyDefaultsTree(
  assets: AssetSource,
  prefix: string,
): Activation[] {
  return assets.keysByPrefix(prefix).map((key) => applyDefaults(key));
}

function defaultsStep(entry: DefaultsEntry, context: Context): ReconcileStep {
  const displayValue = defaultsArg(entry.type, entry.value, context.home);
  const label = `macOS setting ${entry.domain} / ${entry.key}`;
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
        return {
          key: label,
          value: `current: ${displayValue}`,
          status: 'unchanged',
        };
      }
      const result = await context.commands.run('defaults', writeArgs);
      if (result.code !== 0) {
        return {
          key: label,
          value: `wanted: ${displayValue}`,
          status: 'failed',
          error: formatCommandFailure(
            `defaults write failed for ${entry.domain} ${entry.key}`,
            result,
          ),
        };
      }
      const previous = current.code === 0 ? current.stdout.trim() : 'not set';
      return {
        key: label,
        value: `${previous} -> ${displayValue}`,
        status: 'changed',
      };
    },
    onError(error) {
      return {
        key: label,
        value: `wanted: ${displayValue}`,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export const defaultsKind = manifestKind<DefaultsActivation, DefaultsEntry>({
  parse: parseDefaults,
  manifestLabel: 'Defaults config file',
  describe: () => ({
    subject: 'macOS settings',
    unchangedCollection: 'macOS settings',
  }),
  // Entries are unique per (domain, key) and each step is a handful of
  // independent `defaults` spawns serialized by cfprefsd, so the probe-heavy
  // reconciliation runs concurrently instead of paying every spawn in sequence.
  concurrency: 4,
  steps: async (entries, _activation, context) =>
    entries.map((entry) => defaultsStep(entry, context)),
});

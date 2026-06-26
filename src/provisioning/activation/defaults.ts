import { basename, extname } from 'node:path';
import { ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';
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

interface DefaultsEntry {
  readonly key: string;
  readonly domain: string;
  readonly type: 'bool' | 'int' | 'float' | 'string';
  readonly value: boolean | number | string;
}

function parseDefaults(raw: string, path: string): Promise<DefaultsEntry[]> {
  return import('js-yaml').then(({ load }) => {
    const parsed = load(raw);
    if (!Array.isArray(parsed)) {
      throw new ProvisioningError(
        `Defaults config file must contain a YAML list: ${path}`,
      );
    }
    return parsed as DefaultsEntry[];
  });
}

function defaultsArg(
  type: string,
  value: boolean | number | string,
  home: string,
): string {
  if (type === 'bool') return value ? 'YES' : 'NO';
  return String(value).replace('$HOME', home).replace(/^~/, home);
}

function defaultsStep(entry: DefaultsEntry, context: Context): ReconcileStep {
  const displayValue = defaultsArg(entry.type, entry.value, context.home);
  return {
    async run() {
      const result = await context.commands.run('defaults', [
        'write',
        entry.domain,
        entry.key,
        `-${entry.type}`,
        displayValue,
      ]);
      if (result.code !== 0) {
        return {
          key: entry.key,
          value: displayValue,
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
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
  plan: boolean,
): Promise<ActivationReport> {
  return reconcile(describeDefaults(activation), plan, {
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

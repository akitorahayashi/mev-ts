import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
  type StepReport,
} from './contract';

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

async function readDefaultsEntries(
  configKey: string,
  home: string,
): Promise<DefaultsEntry[]> {
  const { load } = await import('js-yaml');
  const path = deployedPath({ key: configKey }, home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ProvisioningError(
      `Defaults config file not found: ${path}. Run without --plan to deploy first.`,
    );
  }
  const parsed = load(raw);
  if (!Array.isArray(parsed)) {
    throw new ProvisioningError(
      `Defaults config file must contain a YAML list: ${path}`,
    );
  }
  return parsed as DefaultsEntry[];
}

function defaultsArg(
  type: string,
  value: boolean | number | string,
  home: string,
): string {
  if (type === 'bool') return value ? 'YES' : 'NO';
  return String(value).replace('$HOME', home).replace(/^~/, home);
}

export async function runDefaults(
  activation: DefaultsActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeDefaults(activation);
  try {
    const defaults = await readDefaultsEntries(
      activation.configKey,
      context.home,
    );
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const entries: StepReport[] = [];
    let failed = false;
    for (const entry of defaults) {
      const displayValue = defaultsArg(entry.type, entry.value, context.home);
      const result = await context.commands.run('defaults', [
        'write',
        entry.domain,
        entry.key,
        `-${entry.type}`,
        displayValue,
      ]);
      if (result.code !== 0) {
        entries.push({
          key: entry.key,
          value: displayValue,
          status: 'failed',
          error: result.stderr.trim() || `exit code ${result.code}`,
        });
        failed = true;
      } else {
        entries.push({
          key: entry.key,
          value: displayValue,
          status: 'changed',
        });
      }
    }
    return { ...base, status: failed ? 'failed' : 'changed', entries };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

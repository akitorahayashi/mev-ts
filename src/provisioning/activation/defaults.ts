import { basename, extname } from 'node:path';
import { errorMessage, ProvisioningError } from '../../errors';
import { commandFailureDetail } from '../../host/command';
import type { Context } from '../../host/context';
import { loadYaml } from '../../host/yaml';
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

interface DefaultsEntry {
  readonly key: string;
  readonly domain: string;
  readonly type: 'bool' | 'int' | 'float' | 'string';
  readonly value: boolean | number | string;
}

const DEFAULTS_TYPES = new Set(['bool', 'int', 'float', 'string']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidDefaultsEntry(
  path: string,
  index: number,
  message: string,
): ProvisioningError {
  return new ProvisioningError(
    `Invalid defaults config ${path} entry ${index + 1}: ${message}`,
  );
}

function validateDefaultsEntry(
  entry: unknown,
  path: string,
  index: number,
): DefaultsEntry {
  if (!isRecord(entry)) {
    throw invalidDefaultsEntry(path, index, 'entry must be a mapping.');
  }
  const { domain, key, type, value } = entry;
  if (typeof domain !== 'string' || domain.trim() === '') {
    throw invalidDefaultsEntry(
      path,
      index,
      "'domain' must be a non-empty string.",
    );
  }
  if (typeof key !== 'string' || key.trim() === '') {
    throw invalidDefaultsEntry(
      path,
      index,
      "'key' must be a non-empty string.",
    );
  }
  if (typeof type !== 'string' || !DEFAULTS_TYPES.has(type)) {
    throw invalidDefaultsEntry(
      path,
      index,
      "'type' must be one of bool, int, float, string.",
    );
  }
  if (type === 'bool' && typeof value !== 'boolean') {
    throw invalidDefaultsEntry(path, index, "'value' must be a boolean.");
  }
  if (
    type === 'int' &&
    (typeof value !== 'number' || !Number.isInteger(value))
  ) {
    throw invalidDefaultsEntry(path, index, "'value' must be an integer.");
  }
  if (
    type === 'float' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw invalidDefaultsEntry(path, index, "'value' must be a finite number.");
  }
  if (type === 'string' && typeof value !== 'string') {
    throw invalidDefaultsEntry(path, index, "'value' must be a string.");
  }
  return { domain, key, type, value } as DefaultsEntry;
}

function parseDefaults(raw: string, path: string): DefaultsEntry[] {
  const parsed = loadYaml(raw);
  if (!Array.isArray(parsed)) {
    throw new ProvisioningError(
      `Defaults config file must contain a YAML list: ${path}`,
    );
  }
  return parsed.map((entry, index) =>
    validateDefaultsEntry(entry, path, index),
  );
}

function defaultsArg(
  type: DefaultsEntry['type'],
  value: boolean | number | string,
  home: string,
): string {
  if (type === 'bool') return value ? 'YES' : 'NO';
  return String(value).replaceAll('$HOME', home).replace(/^~/, home);
}

function readValue(stdout: string): string {
  return stdout.replace(/\r?\n$/, '');
}

function defaultsValueMatches(
  type: DefaultsEntry['type'],
  expected: string,
  actualStdout: string,
): boolean {
  const actual = readValue(actualStdout);
  if (type === 'bool') {
    return actual.trim() === (expected === 'YES' ? '1' : '0');
  }
  if (type === 'int' || type === 'float') {
    const actualNumber = Number(actual.trim());
    const expectedNumber = Number(expected);
    return (
      Number.isFinite(actualNumber) &&
      Number.isFinite(expectedNumber) &&
      actualNumber === expectedNumber
    );
  }
  return actual === expected;
}

function defaultsTypeMatches(
  expected: DefaultsEntry['type'],
  actualStdout: string,
): boolean {
  const actual = readValue(actualStdout).trim().toLowerCase();
  const type = actual.startsWith('type is ')
    ? actual.slice('type is '.length)
    : actual;
  if (expected === 'bool') return type === 'boolean' || type === 'bool';
  if (expected === 'int') return type === 'integer' || type === 'int';
  return type === expected;
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
          error: commandFailureDetail(result, `exit code ${result.code}`),
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

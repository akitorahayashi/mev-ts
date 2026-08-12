import { ProvisioningError } from '../errors';
import {
  isRecord,
  requireExactKeys,
  requireNonEmptyString,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';

export interface DefaultsEntry {
  readonly key: string;
  readonly domain: string;
  readonly type: 'bool' | 'int' | 'float' | 'string';
  readonly value: boolean | number | string;
}

const DEFAULTS_TYPES = new Set(['bool', 'int', 'float', 'string']);

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
  requireExactKeys(
    entry,
    ['domain', 'key', 'type', 'value'],
    `Invalid defaults config ${path} entry ${index + 1}`,
  );
  const { type, value } = entry;
  const entryLabel = `Invalid defaults config ${path} entry ${index + 1}`;
  const domain = requireNonEmptyString(
    entry['domain'],
    `${entryLabel}: 'domain'`,
  );
  const key = requireNonEmptyString(entry['key'], `${entryLabel}: 'key'`);
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

export function parseDefaults(raw: string, path: string): DefaultsEntry[] {
  const parsed = loadYaml(raw, path);
  if (!Array.isArray(parsed)) {
    throw new ProvisioningError(
      `Defaults config file must contain a YAML list: ${path}`,
    );
  }
  const entries = parsed.map((entry, index) =>
    validateDefaultsEntry(entry, path, index),
  );
  requireUniqueBy(
    entries,
    (entry) => `(${entry.domain}, ${entry.key})`,
    `Defaults config ${path}`,
  );
  return entries;
}

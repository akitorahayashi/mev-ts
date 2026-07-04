import { unlink } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { isNotFound, readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { dumpYaml, loadYaml } from '../host/yaml';

export interface NameSplit {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly unknown: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readNameList(
  manifestPath: string,
  key: string,
  label: string,
): Promise<string[]> {
  const raw = await readTextIfPresent(manifestPath);
  if (raw === null) {
    return [];
  }
  const parsed = loadYaml(raw);
  if (!isRecord(parsed) || parsed[key] === undefined) {
    return [];
  }
  const value = parsed[key];
  if (!Array.isArray(value)) {
    throw new ProvisioningError(
      `Invalid ${label} ${manifestPath}: '${key}' must be a sequence.`,
    );
  }
  if (!value.every((entry) => typeof entry === 'string')) {
    throw new ProvisioningError(
      `Invalid ${label} ${manifestPath}: '${key}' must be a sequence of strings.`,
    );
  }
  return value;
}

export async function writeNameList(
  manifestPath: string,
  key: string,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) {
    try {
      await unlink(manifestPath);
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
    return;
  }
  await writeFileAtomically(manifestPath, dumpYaml({ [key]: [...names] }));
}

export function splitNames(
  catalog: readonly string[],
  includedNames: readonly string[],
): NameSplit {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const name of catalog) {
    if (includedNames.includes(name)) {
      included.push(name);
    } else {
      excluded.push(name);
    }
  }
  const unknown = includedNames.filter((name) => !catalog.includes(name));
  return { included, excluded, unknown };
}

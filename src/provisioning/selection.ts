import { unlink } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { isNotFound, readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { isRecord, requireStringArray } from '../host/parse';
import { dumpYaml, loadYaml } from '../host/yaml';

interface NameSplit {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly unknown: readonly string[];
}

/** How a selection manifest's stored list is interpreted against the catalog. */
export type SelectionMode = 'opt-in' | 'opt-out';

/** A catalog resolved against a stored list under one polarity. */
export interface Selection {
  /** Catalog entries that are on, in catalog order. */
  readonly enabled: readonly string[];
  /** Catalog entries that are off, in catalog order. */
  readonly disabled: readonly string[];
  /** Stored names the catalog does not contain (skew), surfaced as warnings. */
  readonly unknown: readonly string[];
}

/**
 * Resolve a catalog against a stored list. Under `opt-out`, listed names are
 * disabled and everything else in the catalog is enabled (so catalog entries
 * added across updates stay on). Under `opt-in`, only listed names are enabled
 * (so a new override never silently starts applying). Stored names the catalog
 * lacks are reported as `unknown`, never silently dropped.
 */
export function resolveSelection(
  catalog: readonly string[],
  listed: readonly string[],
  mode: SelectionMode,
): Selection {
  const split = splitNames(catalog, listed);
  if (mode === 'opt-out') {
    return {
      enabled: split.excluded,
      disabled: split.included,
      unknown: split.unknown,
    };
  }
  return {
    enabled: split.included,
    disabled: split.excluded,
    unknown: split.unknown,
  };
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
  const parsed = loadYaml(raw, `${label} ${manifestPath}`);
  // A present file that is not a mapping, or one missing the key, is a hand-edit
  // or corruption — surfaced rather than silently read as an empty selection
  // (which, under opt-out, would re-enable everything).
  if (!isRecord(parsed)) {
    throw new ProvisioningError(
      `Invalid ${label} ${manifestPath}: expected a mapping with a '${key}' sequence.`,
    );
  }
  if (parsed[key] === undefined) {
    throw new ProvisioningError(
      `Invalid ${label} ${manifestPath}: missing '${key}' sequence.`,
    );
  }
  return requireStringArray(
    parsed[key],
    `Invalid ${label} ${manifestPath}: '${key}'`,
  );
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

function splitNames(
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

import { unlink } from 'node:fs/promises';
import { errorMessage, ProvisioningError } from '../errors';
import { isNotFound, readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import {
  isRecord,
  requireExactKeys,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';
import { dumpYaml, loadYaml } from '../host/yaml';

interface NameSplit {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly unknown: readonly string[];
}

export type SelectionMode = 'opt-in' | 'opt-out';

/**
 * The manifest key each polarity stores under. Derived from the mode rather than
 * declared alongside it: a manifest listing `disabled` names resolved under
 * `opt-in` would invert every entry's meaning silently, and nothing downstream
 * could detect it.
 */
const KEY_BY_MODE: Readonly<Record<SelectionMode, string>> = {
  'opt-out': 'disabled',
  'opt-in': 'enabled',
};

/**
 * One selection surface's polarity, bound to the manifest key that expresses it
 * and to the read/write/resolve operations that must agree on both. Consumers
 * hold the policy instead of passing a mode literal alongside a list, so the
 * `app/` toggle flow and the activation that applies the result cannot disagree
 * about what a stored name means.
 */
export interface SelectionPolicy {
  readonly mode: SelectionMode;
  readonly key: string;
  read(manifestPath: string): Promise<string[]>;
  write(manifestPath: string, names: readonly string[]): Promise<void>;
  resolve(catalog: readonly string[], manifestPath: string): Promise<Selection>;
}

export function selectionPolicy(
  mode: SelectionMode,
  label: string,
): SelectionPolicy {
  const key = KEY_BY_MODE[mode];
  return {
    mode,
    key,
    read: (manifestPath) => readNameList(manifestPath, key, label),
    write: (manifestPath, names) => writeNameList(manifestPath, key, names),
    async resolve(catalog, manifestPath) {
      return resolveSelection(
        catalog,
        await readNameList(manifestPath, key, label),
        mode,
      );
    },
  };
}

/** A catalog resolved against a stored list under one polarity. */
export interface Selection {
  /** Catalog entries that are on, in catalog order. */
  readonly enabled: readonly string[];
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
      unknown: split.unknown,
    };
  }
  return {
    enabled: split.included,
    unknown: split.unknown,
  };
}

export async function readNameList(
  manifestPath: string,
  key: string,
  label: string,
): Promise<string[]> {
  let raw: string | null;
  try {
    raw = await readTextIfPresent(manifestPath);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to read ${label} at ${manifestPath}: ${errorMessage(error)}`,
    );
  }
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
  requireExactKeys(parsed, [key], `Invalid ${label} ${manifestPath}`);
  const names = requireStringArray(
    parsed[key],
    `Invalid ${label} ${manifestPath}: '${key}'`,
  );
  if (names.some((name) => name.length === 0)) {
    throw new ProvisioningError(
      `Invalid ${label} ${manifestPath}: '${key}' must contain non-empty names.`,
    );
  }
  requireUniqueBy(
    names,
    (name) => name,
    `Invalid ${label} ${manifestPath}: '${key}'`,
  );
  return names;
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
        throw new ProvisioningError(
          `Failed to remove ${key} selection manifest at ${manifestPath}: ${errorMessage(err)}`,
        );
      }
    }
    return;
  }
  try {
    await writeFileAtomically(manifestPath, dumpYaml({ [key]: [...names] }));
  } catch (error) {
    throw new ProvisioningError(
      `Failed to write ${key} selection manifest at ${manifestPath}: ${errorMessage(error)}`,
    );
  }
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

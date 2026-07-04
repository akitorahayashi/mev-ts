import { readNameList, splitNames, writeNameList } from '../selection';

/**
 * The selection manifest records only what the user turned off. The catalog is
 * the authority for what exists; anything absent from `disabled` is enabled, so
 * catalog entries added across mev updates stay enabled by default rather than
 * being silently dropped.
 */

/** The resolution of a catalog against a disabled list. */
export interface Selection {
  /** Catalog entries that are enabled, in catalog order. */
  readonly enabled: readonly string[];
  /** Catalog entries that are disabled, in catalog order. */
  readonly disabled: readonly string[];
  /** Disabled names absent from the catalog (skew), surfaced as warnings. */
  readonly unknownDisabled: readonly string[];
}

/**
 * Read the disabled list from a manifest path. Absence or an empty list means
 * nothing is disabled.
 */
export async function readDisabled(manifestPath: string): Promise<string[]> {
  return readNameList(manifestPath, 'disabled', 'selection manifest');
}

/**
 * Resolve a catalog against a disabled list (the version-skew rule). Catalog
 * entries absent from `disabled` are enabled; present ones are disabled. Names
 * in `disabled` that the catalog does not contain cannot exclude anything and
 * are reported as `unknownDisabled`, never silently dropped.
 */
export function resolve(
  catalog: readonly string[],
  disabled: readonly string[],
): Selection {
  const split = splitNames(catalog, disabled);
  return {
    enabled: split.excluded,
    disabled: split.included,
    unknownDisabled: split.unknown,
  };
}

/**
 * Persist the disabled list to the manifest path. An empty list removes the
 * file (absent manifest = all enabled). Creates parent directories as needed.
 */
export async function writeDisabled(
  manifestPath: string,
  disabled: readonly string[],
): Promise<void> {
  await writeNameList(manifestPath, 'disabled', disabled);
}

import { readNameList, splitNames, writeNameList } from '../selection';

/**
 * The override selection manifest records only what the user turned on. The
 * catalog is the authority for what exists; anything absent from `enabled` is
 * off, so a newly added override never silently starts applying itself.
 */

/** The resolution of a catalog against an enabled list. */
export interface Selection {
  /** Catalog entries that are enabled, in catalog order. */
  readonly enabled: readonly string[];
  /** Catalog entries that are disabled, in catalog order. */
  readonly disabled: readonly string[];
  /** Enabled names absent from the catalog (skew), surfaced as warnings. */
  readonly unknownEnabled: readonly string[];
}

/**
 * Read the enabled list from a manifest path. Absence or an empty list means
 * nothing is enabled.
 */
export async function readEnabled(manifestPath: string): Promise<string[]> {
  return readNameList(manifestPath, 'enabled', 'override manifest');
}

/**
 * Resolve a catalog against an enabled list (the version-skew rule). Catalog
 * entries present in `enabled` are enabled; the rest are disabled. Names in
 * `enabled` that the catalog does not contain cannot enable anything and are
 * reported as `unknownEnabled`, never silently dropped.
 */
export function resolve(
  catalog: readonly string[],
  enabled: readonly string[],
): Selection {
  const split = splitNames(catalog, enabled);
  return {
    enabled: split.included,
    disabled: split.excluded,
    unknownEnabled: split.unknown,
  };
}

/**
 * Persist the enabled list to the manifest path. An empty list removes the
 * file (absent manifest = nothing enabled). Creates parent directories as
 * needed.
 */
export async function writeEnabled(
  manifestPath: string,
  enabled: readonly string[],
): Promise<void> {
  await writeNameList(manifestPath, 'enabled', enabled);
}

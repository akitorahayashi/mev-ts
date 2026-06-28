import { unlink } from 'node:fs/promises';
import { ProvisioningError } from '../../errors';
import { isNotFound, readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';

/**
 * The selection manifest records only what the user turned off. The catalog is
 * the authority for what exists; anything absent from `disabled` is enabled, so
 * catalog entries added across mev updates stay enabled by default rather than
 * being silently dropped.
 */

interface ManifestFile {
  readonly disabled?: unknown;
}

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
  const raw = await readTextIfPresent(manifestPath);
  if (raw === null) {
    return [];
  }
  const { load } = await import('js-yaml');
  const parsed = load(raw) as ManifestFile;
  if (parsed?.disabled === undefined) {
    return [];
  }
  if (!Array.isArray(parsed.disabled)) {
    throw new ProvisioningError(
      `Invalid selection manifest ${manifestPath}: 'disabled' must be a sequence.`,
    );
  }
  return parsed.disabled as string[];
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
  const enabled: string[] = [];
  const disabledInCatalog: string[] = [];
  for (const name of catalog) {
    if (disabled.includes(name)) {
      disabledInCatalog.push(name);
    } else {
      enabled.push(name);
    }
  }
  const unknownDisabled = disabled.filter((name) => !catalog.includes(name));
  return { enabled, disabled: disabledInCatalog, unknownDisabled };
}

/**
 * Persist the disabled list to the manifest path. An empty list removes the
 * file (absent manifest = all enabled). Creates parent directories as needed.
 */
export async function writeDisabled(
  manifestPath: string,
  disabled: readonly string[],
): Promise<void> {
  if (disabled.length === 0) {
    try {
      await unlink(manifestPath);
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
    return;
  }
  const { dump } = await import('js-yaml');
  await writeFileAtomically(manifestPath, dump({ disabled: [...disabled] }));
}

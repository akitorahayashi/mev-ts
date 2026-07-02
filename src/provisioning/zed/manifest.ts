import { unlink } from 'node:fs/promises';
import { ProvisioningError } from '../../errors';
import { isNotFound, readTextIfPresent } from '../../host/absence';
import { writeFileAtomically } from '../../host/atomic-file';

/**
 * The override selection manifest records only what the user turned on. The
 * catalog is the authority for what exists; anything absent from `enabled` is
 * off, so a newly added override never silently starts applying itself.
 */

interface ManifestFile {
  readonly enabled?: unknown;
}

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
  const raw = await readTextIfPresent(manifestPath);
  if (raw === null) {
    return [];
  }
  const { load } = await import('js-yaml');
  const parsed = load(raw) as ManifestFile;
  if (parsed?.enabled === undefined) {
    return [];
  }
  if (!Array.isArray(parsed.enabled)) {
    throw new ProvisioningError(
      `Invalid override manifest ${manifestPath}: 'enabled' must be a sequence.`,
    );
  }
  if (!parsed.enabled.every((entry) => typeof entry === 'string')) {
    throw new ProvisioningError(
      `Invalid override manifest ${manifestPath}: 'enabled' must be a sequence of strings.`,
    );
  }
  return parsed.enabled;
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
  const enabledInCatalog: string[] = [];
  const disabled: string[] = [];
  for (const name of catalog) {
    if (enabled.includes(name)) {
      enabledInCatalog.push(name);
    } else {
      disabled.push(name);
    }
  }
  const unknownEnabled = enabled.filter((name) => !catalog.includes(name));
  return { enabled: enabledInCatalog, disabled, unknownEnabled };
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
  if (enabled.length === 0) {
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
  await writeFileAtomically(manifestPath, dump({ enabled: [...enabled] }));
}

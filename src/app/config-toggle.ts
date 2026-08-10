import type { SelectionPolicy } from '../config-selection/selection';

/**
 * Present a catalog for interactive multi-select and return the names to keep
 * enabled, or null if the user cancelled. Implemented by `toggle` and injected
 * by the config commands so this flow stays free of the prompt library.
 */
export type SelectEntries = (
  message: string,
  catalog: readonly string[],
  enabled: readonly string[],
) => Promise<string[] | null>;

export interface ConfigToggleSurface {
  readonly catalog: readonly string[];
  readonly manifestPath: string;
  readonly message: string;
  readonly policy: SelectionPolicy;
}

/**
 * The shared toggle flow: resolve the stored manifest against the catalog, warn
 * about catalog skew, prompt, and persist the choice in the manifest's polarity.
 * Cancelling leaves the manifest untouched.
 */
export async function configSelectManifest(
  selection: ConfigToggleSurface,
  warn: (message: string) => void,
  select: SelectEntries,
): Promise<void> {
  const { enabled, unknown } = await selection.policy.resolve(
    selection.catalog,
    selection.manifestPath,
  );
  if (unknown.length > 0) {
    warn(`warning: manifest names not in catalog: ${unknown.join(', ')}\n`);
  }

  const chosen = await select(selection.message, selection.catalog, enabled);
  if (chosen === null) return;

  await selection.policy.write(
    selection.manifestPath,
    persistedList(selection.catalog, chosen, selection.policy.mode),
  );
}

/**
 * Turn everything off. Opt-out writes a snapshot of today's catalog as disabled;
 * opt-in writes an empty enabled list. The polarity is intentional and differs
 * per surface — see each command's `--clear` description.
 */
export async function configClearManifest(
  selection: ConfigToggleSurface,
): Promise<void> {
  await selection.policy.write(
    selection.manifestPath,
    selection.policy.mode === 'opt-out' ? [...selection.catalog] : [],
  );
}

function persistedList(
  catalog: readonly string[],
  chosen: readonly string[],
  mode: SelectionPolicy['mode'],
): readonly string[] {
  return mode === 'opt-out'
    ? catalog.filter((name) => !chosen.includes(name))
    : chosen;
}

import {
  resolveSelection,
  type SelectionMode,
} from '../provisioning/selection';

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

/** One selectable surface: its catalog plus how its manifest is read/written. */
export interface ConfigSelection {
  readonly catalog: readonly string[];
  readonly read: () => Promise<string[]>;
  readonly write: (names: readonly string[]) => Promise<void>;
  readonly message: string;
  readonly mode: SelectionMode;
}

/**
 * The shared toggle flow: resolve the stored manifest against the catalog, warn
 * about catalog skew, prompt, and persist the choice in the manifest's polarity.
 * Cancelling leaves the manifest untouched.
 */
export async function configSelectManifest(
  selection: ConfigSelection,
  warn: (message: string) => void,
  select: SelectEntries,
): Promise<void> {
  const listed = await selection.read();
  const { enabled, unknown } = resolveSelection(
    selection.catalog,
    listed,
    selection.mode,
  );
  if (unknown.length > 0) {
    warn(`warning: manifest names not in catalog: ${unknown.join(', ')}\n`);
  }

  const chosen = await select(selection.message, selection.catalog, enabled);
  if (chosen === null) return;

  await selection.write(
    persistedList(selection.catalog, chosen, selection.mode),
  );
}

/**
 * Turn everything off. Opt-out writes a snapshot of today's catalog as disabled;
 * opt-in writes an empty enabled list. The polarity is intentional and differs
 * per surface — see each command's `--clear` description.
 */
export async function configClearManifest(
  selection: ConfigSelection,
): Promise<void> {
  await selection.write(
    selection.mode === 'opt-out' ? [...selection.catalog] : [],
  );
}

function persistedList(
  catalog: readonly string[],
  chosen: readonly string[],
  mode: SelectionMode,
): readonly string[] {
  // Opt-out stores the disabled complement; opt-in stores the enabled set.
  return mode === 'opt-out'
    ? catalog.filter((name) => !chosen.includes(name))
    : chosen;
}

import { readNameList, writeNameList } from '../selection';

/**
 * The AGENTS.md/skills selection manifest records only what the user turned off.
 * The catalog is the authority for what exists; anything absent from `disabled`
 * is enabled (opt-out), so catalog entries added across mev updates stay enabled
 * rather than being silently dropped. See `resolveSelection` for the polarity.
 */

/**
 * Read the disabled list from a manifest path. Absence means nothing disabled.
 */
export async function readDisabled(manifestPath: string): Promise<string[]> {
  return readNameList(manifestPath, 'disabled', 'selection manifest');
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

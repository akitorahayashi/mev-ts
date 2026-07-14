import { readNameList, writeNameList } from '../selection';

/**
 * The override selection manifest records only what the user turned on. The
 * catalog is the authority for what exists; anything absent from `enabled` is
 * off (opt-in), so a newly added override never silently starts applying
 * itself. See `resolveSelection` for the polarity.
 */

/**
 * Read the enabled list from a manifest path. Absence means nothing enabled.
 */
export async function readEnabled(manifestPath: string): Promise<string[]> {
  return readNameList(manifestPath, 'enabled', 'override manifest');
}

/**
 * Persist the enabled list to the manifest path. An empty list removes the file
 * (absent manifest = nothing enabled). Creates parent directories as needed.
 */
export async function writeEnabled(
  manifestPath: string,
  enabled: readonly string[],
): Promise<void> {
  await writeNameList(manifestPath, 'enabled', enabled);
}

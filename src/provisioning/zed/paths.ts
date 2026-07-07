import { join } from 'node:path';

/** Deployed source for the named settings-override fragments. */
export const OVERRIDES_PREFIX = 'zed/global/overrides';

function zedRoot(home: string): string {
  return join(home, '.config', 'mev', 'zed');
}

/** The generated settings.json built from the base asset plus enabled overrides. */
export function settingsFile(home: string): string {
  return join(zedRoot(home), 'settings.json');
}

/**
 * The override selection manifest; its `enabled` list is opt-in. Absence
 * enables nothing, so a newly added override never silently starts applying
 * itself to an existing settings.json.
 */
export function overridesManifest(home: string): string {
  return join(zedRoot(home), 'overrides-selection.yml');
}

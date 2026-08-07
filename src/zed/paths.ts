import { join } from 'node:path';
import { mevRoot } from '../host/path';

export const OVERRIDES_PREFIX = 'zed/overrides';

function zedRoot(home: string): string {
  return join(home, mevRoot, 'zed');
}

/** The generated settings.json built from the base asset plus enabled overrides. */
export function settingsFile(home: string): string {
  return join(zedRoot(home), 'settings.json');
}

/** Path to the override selection manifest; see `../zed/manifest.ts` for the opt-in read/write contract. */
export function overridesManifest(home: string): string {
  return join(zedRoot(home), 'overrides-selection.yml');
}

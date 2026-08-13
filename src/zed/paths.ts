import { mevPath, resolveHostPath } from '../host/path';

export const OVERRIDES_PREFIX = 'zed/overrides';

function zedPath(home: string, name: string): string {
  return resolveHostPath(mevPath('zed', name), home);
}

/** The generated settings.json built from the base asset plus enabled overrides. */
export function settingsFile(home: string): string {
  return zedPath(home, 'settings.json');
}

/** Path to the override selection manifest; see `../zed/manifest.ts` for the opt-in read/write contract. */
export function overridesManifest(home: string): string {
  return zedPath(home, 'overrides-selection.yml');
}

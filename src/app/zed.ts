import { deployedDir } from '../assets/ref';
import { readOverrides } from '../zed/catalog';
import { readEnabled, writeEnabled } from '../zed/manifest';
import { OVERRIDES_PREFIX, overridesManifest } from '../zed/paths';
import {
  type ConfigToggleSurface,
  configClearManifest,
  configSelectManifest,
  type SelectEntries,
} from './config-toggle';

async function zedSelection(home: string): Promise<ConfigToggleSurface> {
  const manifest = overridesManifest(home);
  return {
    catalog: await readOverrides(deployedDir(OVERRIDES_PREFIX, home)),
    read: () => readEnabled(manifest),
    write: (names) => writeEnabled(manifest, names),
    message: 'Select enabled Zed setting overrides',
    mode: 'opt-in',
  };
}

export async function configSelectZedOverrides(
  home: string,
  warn: (message: string) => void,
  select: SelectEntries,
): Promise<void> {
  await configSelectManifest(await zedSelection(home), warn, select);
}

export async function configSelectZedOverridesClear(
  home: string,
): Promise<void> {
  await configClearManifest(await zedSelection(home));
}

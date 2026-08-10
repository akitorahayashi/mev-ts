import { deployedDir } from '../assets/ref';
import { readOverrides } from '../zed/catalog';
import { overrideSelection } from '../zed/manifest';
import { OVERRIDES_PREFIX, overridesManifest } from '../zed/paths';
import {
  type ConfigToggleSurface,
  configClearManifest,
  configSelectManifest,
  type SelectEntries,
} from './config-toggle';

async function zedSelection(home: string): Promise<ConfigToggleSurface> {
  return {
    catalog: await readOverrides(deployedDir(OVERRIDES_PREFIX, home)),
    manifestPath: overridesManifest(home),
    message: 'Select enabled Zed setting overrides',
    policy: overrideSelection,
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

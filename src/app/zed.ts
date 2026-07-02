import { deployedDir } from '../assets/ref';
import { toggle } from '../cli/tty/toggle';
import { readOverrides } from '../provisioning/zed/catalog';
import {
  readEnabled,
  resolve,
  writeEnabled,
} from '../provisioning/zed/manifest';
import { OVERRIDES_PREFIX, overridesManifest } from '../provisioning/zed/paths';

export async function configSelectZedOverrides(home: string): Promise<void> {
  const sourceDir = deployedDir(OVERRIDES_PREFIX, home);
  const catalog = await readOverrides(sourceDir);
  const manifest = overridesManifest(home);
  const { enabled } = resolve(catalog, await readEnabled(manifest));

  const chosen = await toggle(
    'Select enabled Zed setting overrides',
    catalog,
    enabled,
  );
  if (chosen === null) return;

  await writeEnabled(manifest, chosen);
}

export async function configSelectZedOverridesClear(
  home: string,
): Promise<void> {
  await writeEnabled(overridesManifest(home), []);
}

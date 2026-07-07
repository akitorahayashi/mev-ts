import { deployedDir } from '../assets/ref';
import { toggle } from '../cli/tty/toggle';
import { readOverrides } from '../provisioning/zed/catalog';
import {
  readEnabled,
  resolve,
  writeEnabled,
} from '../provisioning/zed/manifest';
import { OVERRIDES_PREFIX, overridesManifest } from '../provisioning/zed/paths';

export async function configSelectZedOverrides(
  home: string,
  warn: (message: string) => void,
): Promise<void> {
  const sourceDir = deployedDir(OVERRIDES_PREFIX, home);
  const catalog = await readOverrides(sourceDir);
  const manifest = overridesManifest(home);
  const { enabled, unknownEnabled } = resolve(
    catalog,
    await readEnabled(manifest),
  );
  if (unknownEnabled.length > 0) {
    warn(
      `warning: manifest names not in catalog: ${unknownEnabled.join(', ')}\n`,
    );
  }

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

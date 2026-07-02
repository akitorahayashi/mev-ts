import {
  type AssetRef,
  deployedDir,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import { readOverrides } from '../zed/catalog';
import { readEnabled, resolve } from '../zed/manifest';
import { overridesManifest, settingsFile } from '../zed/paths';
import { buildSettings } from '../zed/settings';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
} from './contract';

type ZedSettingsActivation = Extract<Activation, { kind: 'zedSettings' }>;

/**
 * Build the intermediate settings.json from the base asset plus the enabled
 * override fragments, and symlink it to Zed's real settings path.
 */
export function zedSettings(
  base: AssetRef,
  overridesPrefix: string,
  dest: HostPath,
): Activation {
  return { kind: 'zedSettings', base, overridesPrefix, dest };
}

export function describeZedSettings(
  activation: ZedSettingsActivation,
): Described {
  return {
    verb: 'apply',
    source: deployedSymbolic(activation.base),
    dest: symbolic(activation.dest),
  };
}

export async function runZedSettings(
  activation: ZedSettingsActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeZedSettings(activation);
  try {
    const basePath = deployedPath(activation.base, context.home);
    const sourceDir = deployedDir(activation.overridesPrefix, context.home);
    const catalog = await readOverrides(sourceDir);
    const enabled = await readEnabled(overridesManifest(context.home));
    const { enabled: applied } = resolve(catalog, enabled);

    const output = settingsFile(context.home);
    const built = await buildSettings(basePath, sourceDir, applied, output);

    const link = resolveHostPath(activation.dest, context.home);
    let linked = false;
    if (!(await isSymlinkTo(link, output))) {
      await placeSymlink(link, output, context.overwrite);
      linked = true;
    }
    return { ...base, status: built || linked ? 'changed' : 'unchanged' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

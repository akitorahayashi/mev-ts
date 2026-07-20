import {
  type AssetRef,
  deployedDir,
  deployedPath,
  deployedSymbolic,
} from '../../assets/ref';
import { resolveSelection } from '../../config-selection/selection';
import { errorMessage } from '../../errors';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import { readOverrides } from '../../zed/catalog';
import { readEnabled } from '../../zed/manifest';
import { overridesManifest, settingsFile } from '../../zed/paths';
import { buildSettings } from '../../zed/settings';
import type {
  Activation,
  ActivationReport,
  Described,
  StepReport,
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
    const { enabled: applied, unknown } = resolveSelection(
      catalog,
      enabled,
      'opt-in',
    );

    const output = settingsFile(context.home);
    const built = await buildSettings(basePath, sourceDir, applied, output);

    const link = resolveHostPath(activation.dest, context.home);
    let linked = false;
    if (!(await isSymlinkTo(link, output))) {
      await placeSymlink(link, output);
      linked = true;
    }

    // Under opt-in, an enabled override the catalog no longer contains cannot
    // apply — a misconfiguration, so fail the activation and name each one
    // rather than silently reporting success.
    if (unknown.length > 0) {
      const entries: StepReport[] = unknown.map((name) => ({
        key: name,
        value: 'not in catalog',
        status: 'failed',
      }));
      return { ...base, status: 'failed', entries };
    }
    return { ...base, status: built || linked ? 'changed' : 'unchanged' };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

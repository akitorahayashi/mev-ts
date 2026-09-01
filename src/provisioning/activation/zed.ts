import { type AssetRef, deployedDir, deployedPath } from '../../assets/ref';
import type { Context } from '../../host/context';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { isSymlinkTo, placeSymlink } from '../../host/symlink';
import { readOverrides } from '../../zed/catalog';
import { overrideSelection } from '../../zed/manifest';
import { overridesManifest, settingsFile } from '../../zed/paths';
import { buildSettings } from '../../zed/settings';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
  ReconcileItemResult,
} from './contract';
import { activationReport, guarded } from './reconcile';

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
): ActivationDescription {
  return {
    subject: symbolic(activation.dest),
  };
}

export async function runZedSettings(
  activation: ZedSettingsActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeZedSettings(activation);
  return guarded(base, async () => {
    const basePath = deployedPath(activation.base, context.home);
    const sourceDir = deployedDir(activation.overridesPrefix, context.home);
    const catalog = await readOverrides(sourceDir);
    const { enabled: applied, unknown } = await overrideSelection.resolve(
      catalog,
      overridesManifest(context.home),
    );

    // Under opt-in, an enabled override the catalog no longer contains cannot
    // apply — a misconfiguration. Fail and name each one before any mutation, so
    // a failed activation never leaves partially-applied settings or a symlink.
    if (unknown.length > 0) {
      const entries: ReconcileItemResult[] = unknown.map((name) => ({
        key: name,
        value: 'not in catalog',
        status: 'failed',
        error: `Selected Zed override is not in the catalog: ${name}`,
      }));
      return { ...base, status: 'failed', entries };
    }

    const output = settingsFile(context.home);
    const built = await buildSettings(basePath, sourceDir, applied, output);

    const link = resolveHostPath(activation.dest, context.home);
    let linked = false;
    if (!(await isSymlinkTo(link, output))) {
      await placeSymlink(link, output);
      linked = true;
    }

    const details = [
      ...(built ? ['selected settings updated'] : []),
      ...(linked ? ['linked to generated settings'] : []),
    ];
    return activationReport(base, [
      {
        label: base.subject,
        status: details.length > 0 ? 'changed' : 'unchanged',
        details:
          details.length > 0
            ? details
            : ['selected settings and link already current'],
      },
    ]);
  });
}

import { stat } from 'node:fs/promises';
import { type AssetRef, deployedPath } from '../../assets/ref';
import { readSshHost } from '../../github/ssh-host';
import { renderConfig } from '../../grove/config';
import type { Context } from '../../host/context';
import { readDeployedText } from '../../host/deployed-file';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import { reconcileRegularFile } from '../../host/regular-file';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
} from './contract';
import { activationReport, guarded } from './reconcile';

type GroveConfigActivation = Extract<Activation, { kind: 'groveConfig' }>;

export function groveConfig(source: AssetRef, dest: HostPath): Activation {
  return { kind: 'groveConfig', source, dest };
}

export function describeGroveConfig(
  activation: GroveConfigActivation,
): ActivationDescription {
  return {
    subject: symbolic(activation.dest),
  };
}

export async function runGroveConfig(
  activation: GroveConfigActivation,
  context: Context,
): Promise<ActivationReport> {
  const base = describeGroveConfig(activation);
  return guarded(base, async () => {
    const source = deployedPath(activation.source, context.home);
    // The absence check runs first so a missing deploy surfaces the canonical
    // deploy-first guidance instead of whichever ENOENT wins the race below.
    const raw = await readDeployedText(source, 'Grove config');
    const [sourceStats, sshHost] = await Promise.all([
      stat(source),
      readSshHost(context.home),
    ]);
    const rendered = renderConfig(raw, sshHost, source);
    const dest = resolveHostPath(activation.dest, context.home);
    const changed = await reconcileRegularFile(
      dest,
      Buffer.from(rendered),
      sourceStats.mode & 0o7777,
    );
    return activationReport(base, [
      {
        label: base.subject,
        status: changed ? 'changed' : 'unchanged',
        details: [
          changed
            ? 'rendered repository configuration updated'
            : 'repository configuration already current',
        ],
      },
    ]);
  });
}

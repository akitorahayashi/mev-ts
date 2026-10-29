import { readFile } from 'node:fs/promises';
import { type AssetRef, deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import { readSshHost } from '../../github/ssh-host';
import { renderConfig } from '../../grove/config';
import { replaceConfig } from '../../grove/replace';
import { statIfPresent } from '../../host/absence';
import type { Context } from '../../host/context';
import { readDeployedText } from '../../host/deployed-file';
import { type HostPath, resolveHostPath, symbolic } from '../../host/path';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
} from './contract';
import { activationReport, guarded } from './reconcile';

type GroveConfigActivation = Extract<Activation, { kind: 'groveConfig' }>;

async function readRegularFile(path: string): Promise<Buffer | null> {
  return (await statIfPresent(path))?.isFile() ? readFile(path) : null;
}

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
    const raw = await readDeployedText(source, 'Grove config');
    const rendered = renderConfig(raw, await readSshHost(context.home), source);
    const dest = resolveHostPath(activation.dest, context.home);
    const existing = await readRegularFile(dest);
    // Replace runs even when the bytes already match: a pin bump that leaves
    // the asset unchanged must still be checked by the newly installed gv.
    const notices = await replaceConfig(rendered, dest, context);
    const written = await readRegularFile(dest);
    if (written === null) {
      throw new ProvisioningError(
        `gv replace exited 0 but left ${base.subject} without a regular file.`,
      );
    }
    const changed = !existing?.equals(written);
    return activationReport(
      base,
      [
        {
          label: base.subject,
          status: changed ? 'changed' : 'unchanged',
          details: [
            changed
              ? 'rendered repository configuration updated'
              : 'repository configuration already current',
          ],
        },
      ],
      notices,
    );
  });
}

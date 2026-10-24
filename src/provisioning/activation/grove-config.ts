import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { type AssetRef, deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import { readSshHost } from '../../github/ssh-host';
import { renderConfig } from '../../grove/config';
import { validateConfig } from '../../grove/validate';
import { lstatIfPresent, readTextIfPresent } from '../../host/absence';
import { writeFileIfChanged } from '../../host/atomic-file';
import type { Context } from '../../host/context';
import { readDeployedText } from '../../host/deployed-file';
import {
  type HostPath,
  mevPath,
  resolveHostPath,
  symbolic,
} from '../../host/path';
import { reconcileRegularFile } from '../../host/regular-file';
import type {
  Activation,
  ActivationDescription,
  ActivationReport,
} from './contract';
import { activationReport, guarded } from './reconcile';

type GroveConfigActivation = Extract<Activation, { kind: 'groveConfig' }>;

/*
 * `gv add` edits the base file in place, so a destination that no longer
 * matches what mev last wrote holds changes only the user can move into the
 * asset or an override; replacing it would silently drop them.
 */
const writtenRecord = mevPath('grove', 'written');

function digest(contents: Buffer): string {
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

async function requireOwned(
  existing: Buffer | null,
  recordPath: string,
  displayDest: string,
): Promise<void> {
  const record = (await readTextIfPresent(recordPath))?.trim();
  if (existing !== null && digest(existing) === record) return;
  throw new ProvisioningError(
    `${displayDest} differs from what mev last wrote. Move its changes into the mev grove asset or a grove.override.toml (gv add --override), move the file aside, and run mev make grove again.`,
  );
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
    // The absence check runs first so a missing deploy surfaces the canonical
    // deploy-first guidance instead of whichever ENOENT wins the race below.
    const raw = await readDeployedText(source, 'Grove config');
    const [sourceStats, sshHost] = await Promise.all([
      stat(source),
      readSshHost(context.home),
    ]);
    const rendered = renderConfig(raw, sshHost, source);
    const contents = Buffer.from(rendered);
    const dest = resolveHostPath(activation.dest, context.home);
    const recordPath = resolveHostPath(writtenRecord, context.home);
    const current = await lstatIfPresent(dest);
    const existing = current?.isFile() ? await readFile(dest) : null;
    if (!existing?.equals(contents)) {
      if (current !== null) {
        await requireOwned(existing, recordPath, base.subject);
      }
      await validateConfig(rendered, dest, context);
    }
    const changed = await reconcileRegularFile(
      dest,
      contents,
      sourceStats.mode & 0o7777,
    );
    await writeFileIfChanged(recordPath, `${digest(contents)}\n`);
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

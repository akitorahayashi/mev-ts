import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  detectArch,
  fetchReleaseBinary,
  installedMatches,
  type ReleaseBinary,
} from '../../github/release';
import type { Context } from '../../host/context';
import {
  type Activation,
  type ActivationReport,
  type Described,
  errorMessage,
  type StepReport,
} from './contract';

type ReleaseActivation = Extract<Activation, { kind: 'release' }>;

export function releaseBinaries(
  binaries: readonly ReleaseBinary[],
): Activation {
  return { kind: 'release', binaries };
}

export function describeRelease(): Described {
  return { verb: 'apply', source: 'release binaries', dest: '~/.cargo/bin' };
}

interface BinaryOutcome {
  readonly report: StepReport;
  readonly failed: boolean;
}

async function reconcileBinary(
  binary: ReleaseBinary,
  arch: string,
  binDir: string,
  context: Context,
): Promise<BinaryOutcome> {
  const dest = join(binDir, binary.name);
  if (await installedMatches(dest, binary.tag, context)) {
    return {
      report: { key: binary.name, value: 'up to date', status: 'unchanged' },
      failed: false,
    };
  }
  try {
    await fetchReleaseBinary(binary, arch, dest, context);
  } catch (error) {
    return {
      report: {
        key: binary.name,
        value: binary.tag,
        status: 'failed',
        error: errorMessage(error),
      },
      failed: true,
    };
  }
  return {
    report: {
      key: binary.name,
      value: `installed ${binary.tag}`,
      status: 'changed',
    },
    failed: false,
  };
}

export async function runRelease(
  activation: ReleaseActivation,
  context: Context,
  plan: boolean,
): Promise<ActivationReport> {
  const base = describeRelease();
  try {
    if (plan) {
      return { ...base, status: 'changed' };
    }
    const arch = await detectArch(context);
    const binDir = join(context.home, '.cargo', 'bin');
    await mkdir(binDir, { recursive: true });

    const reports: StepReport[] = [];
    let failed = false;
    let changed = false;
    // Each binary is independent: a failure is recorded and surfaced, but the
    // remaining binaries are still attempted rather than aborting the batch.
    for (const binary of activation.binaries) {
      const outcome = await reconcileBinary(binary, arch, binDir, context);
      reports.push(outcome.report);
      if (outcome.failed) failed = true;
      else if (outcome.report.status === 'changed') changed = true;
    }

    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries: reports };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

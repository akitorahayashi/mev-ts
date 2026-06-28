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
} from './contract';
import { type ReconcileStep, reconcile } from './reconcile';

type ReleaseActivation = Extract<Activation, { kind: 'release' }>;

export function releaseBinaries(
  binaries: readonly ReleaseBinary[],
): Activation {
  return { kind: 'release', binaries };
}

export function describeRelease(): Described {
  return { verb: 'apply', source: 'release binaries', dest: '~/.cargo/bin' };
}

function releaseStep(
  binary: ReleaseBinary,
  arch: string,
  binDir: string,
  context: Context,
): ReconcileStep {
  const dest = join(binDir, binary.name);
  return {
    async run() {
      if (await installedMatches(dest, binary.tag, context)) {
        return { key: binary.name, value: 'up to date', status: 'unchanged' };
      }
      await fetchReleaseBinary(binary, arch, dest, context);
      return {
        key: binary.name,
        value: `installed ${binary.tag}`,
        status: 'changed',
      };
    },
    onError(error) {
      return {
        key: binary.name,
        value: binary.tag,
        status: 'failed',
        error: errorMessage(error),
      };
    },
  };
}

export function runRelease(
  activation: ReleaseActivation,
  context: Context,
): Promise<ActivationReport> {
  return reconcile(describeRelease(), {
    declare: async () => activation.binaries,
    // Each binary is independent and writes to a unique path, so the
    // network-bound reconciliations run concurrently; the envelope isolates a
    // single binary's failure and preserves declaration order.
    concurrent: true,
    steps: async (binaries) => {
      const arch = await detectArch(context);
      const binDir = join(context.home, '.cargo', 'bin');
      await mkdir(binDir, { recursive: true });
      return binaries.map((binary) =>
        releaseStep(binary, arch, binDir, context),
      );
    },
  });
}

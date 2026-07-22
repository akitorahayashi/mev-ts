import { mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { errorMessage } from '../../errors';
import {
  detectArch,
  fetchReleaseBinary,
  installedMatches,
  parseReleaseBinaries,
  type ReleaseBinary,
} from '../../github/release';
import type { Context } from '../../host/context';
import type { Activation, ActivationReport, Described } from './contract';
import { readDeployedManifest } from './manifest';
import { type ReconcileStep, reconcile } from './reconcile';

type ReleaseActivation = Extract<Activation, { kind: 'release' }>;

const BIN_DIR = '.cargo/bin';
const RELEASE_DOWNLOAD_CONCURRENCY = 4;

export function releaseBinaries(configKey: string): Activation {
  return { kind: 'release', configKey };
}

/** The embedded config asset a `release` activation validates and reads. */
export function releaseConfigAssets(
  activation: ReleaseActivation,
): readonly string[] {
  return [activation.configKey];
}

export function describeRelease(activation: ReleaseActivation): Described {
  return {
    verb: 'apply',
    source: basename(activation.configKey, extname(activation.configKey)),
    dest: `~/${BIN_DIR}`,
  };
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
  return reconcile(describeRelease(activation), {
    declare: () =>
      readDeployedManifest(
        activation.configKey,
        context.home,
        parseReleaseBinaries,
        'Release binaries manifest',
      ),
    // Each binary is independent and writes to a unique path, so the
    // network-bound reconciliations run concurrently; the envelope isolates a
    // single binary's failure and preserves declaration order.
    concurrent: RELEASE_DOWNLOAD_CONCURRENCY,
    steps: async (binaries) => {
      const arch = await detectArch(context);
      const binDir = join(context.home, BIN_DIR);
      await mkdir(binDir, { recursive: true });
      return binaries.map((binary) =>
        releaseStep(binary, arch, binDir, context),
      );
    },
  });
}

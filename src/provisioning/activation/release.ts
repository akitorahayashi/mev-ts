import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from '../../errors';
import {
  detectArch,
  fetchReleaseBinary,
  installedMatches,
  parseReleaseBinaries,
  type ReleaseBinary,
} from '../../github/release';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { manifestKind, manifestSource } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type ReleaseActivation = Extract<Activation, { kind: 'release' }>;

const BIN_DIR = '.cargo/bin';
const RELEASE_DOWNLOAD_CONCURRENCY = 4;

export function releaseBinaries(configKey: string): Activation {
  return { kind: 'release', configKey };
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

const releaseKind = manifestKind<ReleaseActivation, ReleaseBinary>({
  parse: parseReleaseBinaries,
  manifestLabel: 'Release binaries manifest',
  describe: (activation) => ({
    verb: 'apply',
    source: manifestSource(activation.configKey),
    dest: `~/${BIN_DIR}`,
  }),
  // Each binary is independent and writes to a unique path, so the network-bound
  // reconciliations run concurrently; the envelope isolates a single binary's
  // failure and preserves declaration order.
  concurrency: RELEASE_DOWNLOAD_CONCURRENCY,
  steps: async (binaries, _activation, context) => {
    const arch = await detectArch(context);
    const binDir = join(context.home, BIN_DIR);
    await mkdir(binDir, { recursive: true });
    return binaries.map((binary) => releaseStep(binary, arch, binDir, context));
  },
});

export const describeRelease = releaseKind.describe;
export const releaseConfigAssets = releaseKind.configAssets;
export const runRelease = releaseKind.run;

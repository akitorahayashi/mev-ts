import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from '../../errors';
import {
  detectArch,
  fetchReleaseBinary,
  installedMatches,
  parseReleaseBinaries,
  parseReleaseLock,
  type ReleaseArch,
  type ReleaseBinary,
  type ReleaseLock,
  releaseLockKey,
  resolveReleaseDigest,
} from '../../github/release';
import type { Context } from '../../host/context';
import type { Activation } from './contract';
import { readDeployedManifest } from './manifest';
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
  lock: ReleaseLock,
  arch: ReleaseArch,
  binDir: string,
  context: Context,
): ReconcileStep {
  const dest = join(binDir, binary.name);
  return {
    async run() {
      // Resolved inside the step so a lock gap fails only its own binary.
      const digest = resolveReleaseDigest(binary, arch, lock);
      if (await installedMatches(dest, digest)) {
        return { key: binary.name, value: 'up to date', status: 'unchanged' };
      }
      await fetchReleaseBinary(binary, arch, digest, dest, context);
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
  steps: async (binaries, activation, context) => {
    // A missing or invalid lock aborts the whole activation with the same
    // deploy-first guidance as the manifest itself.
    const lock = await readDeployedManifest(
      releaseLockKey(activation.configKey),
      context.home,
      parseReleaseLock,
      'Release binaries lock',
    );
    const arch = await detectArch(context);
    const binDir = join(context.home, BIN_DIR);
    await mkdir(binDir, { recursive: true });
    return binaries.map((binary) =>
      releaseStep(binary, lock, arch, binDir, context),
    );
  },
});

export const describeRelease = releaseKind.describe;
export const runRelease = releaseKind.run;

/** The manifest plus the digest lock that rides along as its sibling asset. */
export function releaseConfigAssets(
  activation: ReleaseActivation,
): readonly string[] {
  return [activation.configKey, releaseLockKey(activation.configKey)];
}

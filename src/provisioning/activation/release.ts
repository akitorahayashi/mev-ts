import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from '../../errors';
import {
  detectArch,
  fetchReleaseBinary,
  installedVersion,
  latestTag,
  parseReleaseBinaries,
  type ReleaseArch,
  type ReleaseBinary,
  resolveLatestTag,
  tagVersion,
} from '../../github/release';
import type { Context } from '../../host/context';
import { needsInstall, shouldUpgrade } from '../../version-pin';
import type { Activation, StepReport } from './contract';
import { manifestKind, manifestSource } from './manifest-kind';
import type { ReconcileStep } from './reconcile';

type ReleaseActivation = Extract<Activation, { kind: 'release' }>;

const BIN_DIR = '.cargo/bin';
const RELEASE_DOWNLOAD_CONCURRENCY = 4;

export function releaseBinaries(configKey: string): Activation {
  return { kind: 'release', configKey };
}

function installed(
  binary: ReleaseBinary,
  tag: string,
  previous: string | null,
): StepReport {
  return {
    key: binary.name,
    value: previous === null ? `installed ${tag}` : `upgraded to ${tag}`,
    status: 'changed',
  };
}

function releaseStep(
  binary: ReleaseBinary,
  arch: ReleaseArch,
  binDir: string,
  context: Context,
  upgrade: boolean,
): ReconcileStep {
  const dest = join(binDir, binary.name);
  const upToDate = (): StepReport => ({
    key: binary.name,
    value: 'up to date',
    status: 'unchanged',
  });
  return {
    async run() {
      // Tags are published as `v<version>` while binaries report the bare
      // version, so the declared side is normalized before the shared
      // pinned-versus-latest policy compares it with what is installed.
      const reported = await installedVersion(dest, context);
      const isInstalled = reported !== null;
      if (binary.tag !== latestTag) {
        if (!needsInstall(tagVersion(binary.tag), reported ?? undefined)) {
          return upToDate();
        }
        await fetchReleaseBinary(binary, binary.tag, arch, dest, context);
        return installed(binary, binary.tag, reported);
      }
      // A latest-assumed binary that is already installed holds still until
      // upgrade mode asks for re-resolution, so a routine run neither reaches
      // the network nor moves a working binary.
      if (isInstalled && !shouldUpgrade(binary.tag, isInstalled, upgrade)) {
        return upToDate();
      }
      const tag = await resolveLatestTag(binary, context);
      if (!needsInstall(tagVersion(tag), reported ?? undefined)) {
        return upToDate();
      }
      await fetchReleaseBinary(binary, tag, arch, dest, context);
      return installed(binary, tag, reported);
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

export const releaseKind = manifestKind<ReleaseActivation, ReleaseBinary>({
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
  steps: async (binaries, _activation, context, runOptions) => {
    const arch = await detectArch(context);
    const binDir = join(context.home, BIN_DIR);
    await mkdir(binDir, { recursive: true });
    return binaries.map((binary) =>
      releaseStep(binary, arch, binDir, context, runOptions.upgrade),
    );
  },
});

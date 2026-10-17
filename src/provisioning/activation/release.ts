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
import { reportActivity } from './activity';
import type {
  Activation,
  ActivationAction,
  ActivationActivity,
  ActivationRunOptions,
  ReconcileItemResult,
} from './contract';
import { manifestKind } from './manifest-kind';
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
): ReconcileItemResult {
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
  options: ActivationRunOptions,
): ReconcileStep {
  const dest = join(binDir, binary.name);
  let sequence = 0;
  let active: ActivationActivity | undefined;
  let phase: string | undefined;
  const finishPhase = () => {
    const activity = active;
    active = undefined;
    if (!activity?.operation) return;
    reportActivity(options.onActivity, {
      ...activity,
      operation: { ...activity.operation, state: 'finished' },
    });
  };
  const startPhase = (action: ActivationAction, subject: string) => {
    finishPhase();
    phase = `${action} ${subject}`;
    active = {
      action,
      subject,
      operation: {
        id: `release:${binary.name}:${sequence++}`,
        group: binary.name,
        state: 'started',
      },
    };
    reportActivity(options.onActivity, active);
  };
  const fetch = (tag: string) =>
    fetchReleaseBinary(binary, tag, arch, dest, context, (action) =>
      startPhase(action, tag),
    );
  const upToDate = (): ReconcileItemResult => ({
    key: binary.name,
    value: 'up to date',
    status: 'unchanged',
  });
  return {
    async run() {
      try {
        // Tags are published as `v<version>` while binaries report the bare
        // version, so the declared side is normalized before the shared
        // pinned-versus-latest policy compares it with what is installed.
        startPhase('check', 'installed version');
        const reported = await installedVersion(dest, context);
        const isInstalled = reported !== null;
        if (binary.tag !== latestTag) {
          if (!needsInstall(tagVersion(binary.tag), reported ?? undefined)) {
            return upToDate();
          }
          await fetch(binary.tag);
          return installed(binary, binary.tag, reported);
        }
        // A latest-assumed binary that is already installed holds still until
        // upgrade mode asks for re-resolution, so a routine run neither reaches
        // the network nor moves a working binary.
        if (
          isInstalled &&
          !shouldUpgrade(binary.tag, isInstalled, options.upgrade)
        ) {
          return upToDate();
        }
        startPhase('resolve', 'latest');
        const tag = await resolveLatestTag(binary, context);
        if (!needsInstall(tagVersion(tag), reported ?? undefined)) {
          return upToDate();
        }
        await fetch(tag);
        return installed(binary, tag, reported);
      } finally {
        finishPhase();
      }
    },
    onError(error) {
      return {
        key: binary.name,
        value: binary.tag,
        status: 'failed',
        error: `${phase ? `${phase}: ` : ''}${errorMessage(error)}`,
      };
    },
  };
}

export const releaseKind = manifestKind<ReleaseActivation, ReleaseBinary>({
  parse: parseReleaseBinaries,
  manifestLabel: 'Release binaries manifest',
  describe: () => ({
    subject: `~/${BIN_DIR} release binaries`,
    unchangedCollection: 'release binaries',
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
      releaseStep(binary, arch, binDir, context, runOptions),
    );
  },
});

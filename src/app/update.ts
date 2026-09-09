import type { Stats } from 'node:fs';
import { chmod, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage, UpdateError } from '../errors';
import {
  detectArch,
  latestTag,
  type ReleaseArch,
  type ReleaseBinary,
  releaseAssetDownloadUrl,
  resolveLatestTag,
} from '../github/release';
import { replaceFileAtomically } from '../host/atomic-file';
import { parseSha256Document, sha256File } from '../host/checksum';
import { runWithCleanup } from '../host/cleanup-error';
import { type CommandRunner, formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import { downloadOverHttps } from '../host/https-download';
import { isSemanticVersion } from '../semantic-version.js';

export type MevBuildKind = 'standalone' | 'bundle';

declare const MEV_BUILD_KIND: MevBuildKind;

const MEV_RELEASE: ReleaseBinary = {
  name: 'mev',
  repo: { owner: 'akitorahayashi', name: 'mev-ts' },
  tag: latestTag,
};

const RELEASE_ARCH: Readonly<Record<ReleaseArch, string>> = {
  aarch64: 'arm64',
  x86_64: 'x64',
};

export type VersionRelation = 'newer' | 'same' | 'ahead';

export type MevUpdateOutcome =
  | {
      readonly kind: 'updated';
      readonly previousVersion: string;
      readonly version: string;
      readonly executablePath: string;
      readonly cleanupWarning?: string;
    }
  | {
      readonly kind: 'reinstalled' | 'current';
      readonly version: string;
      readonly executablePath: string;
      readonly cleanupWarning?: string;
    }
  | {
      readonly kind: 'ahead';
      readonly version: string;
      readonly latestVersion: string;
      readonly executablePath: string;
      readonly cleanupWarning?: string;
    };

export function mevReleaseAsset(arch: ReleaseArch, suffix = ''): string {
  return `mev-darwin-${RELEASE_ARCH[arch]}${suffix}`;
}

function requireSemver(value: string, label: string): void {
  if (!isSemanticVersion(value)) {
    throw new UpdateError(`${label} '${value}' is not a semantic version.`);
  }
}

export function mevVersionFromReleaseTag(tag: string): string {
  if (!tag.startsWith('v')) {
    throw new UpdateError(
      `Latest mev release tag '${tag}' must start with 'v'.`,
    );
  }
  const version = tag.slice(1);
  requireSemver(version, 'Latest mev release version');
  return version;
}

export function compareReleaseVersions(
  current: string,
  latest: string,
): VersionRelation {
  requireSemver(current, 'Installed mev version');
  requireSemver(latest, 'Latest mev release version');
  const order = Bun.semver.order(latest, current);
  if (order > 0) return 'newer';
  if (order < 0) return 'ahead';
  return 'same';
}

export function runtimeBuildKind(): MevBuildKind | null {
  return typeof MEV_BUILD_KIND === 'undefined' ? null : MEV_BUILD_KIND;
}

export function executablePathForBuild(
  kind: MevBuildKind | null,
  execPath: string,
  mainPath: string,
): string {
  if (kind === 'standalone') return execPath;
  if (kind === 'bundle') return mainPath;
  throw new UpdateError(
    "mev update must run from an installed command. Run 'bun run up' first, or install the latest release with install.sh.",
  );
}

export async function requireRegularMevPath(path: string): Promise<string> {
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new UpdateError(
      `Unable to inspect the installed mev command at ${path}: ${errorMessage(error)}`,
    );
  }
  if (!stats.isFile()) {
    throw new UpdateError(
      `The installed mev command at ${path} is not a regular file. Reinstall it with install.sh.`,
    );
  }
  return path;
}

export function resolveInstalledMevPath(): Promise<string> {
  return requireRegularMevPath(
    executablePathForBuild(runtimeBuildKind(), process.execPath, Bun.main),
  );
}

interface UpdateOptions {
  readonly currentVersion: string;
  readonly executablePath: string;
  readonly context: Context;
}

async function installRelease(
  options: UpdateOptions,
  tag: string,
  version: string,
  asset: string,
  expectedSha256: string,
  onCommit: () => void,
): Promise<string | undefined> {
  const { context, executablePath } = options;
  let committed = false;
  try {
    await replaceFileAtomically(
      executablePath,
      async (staged) => {
        await downloadOverHttps(
          context.commands,
          releaseAssetDownloadUrl(MEV_RELEASE.repo, tag, asset),
          staged,
          `mev ${tag}`,
        );
        const actualSha256 = await sha256File(staged);
        if (actualSha256 !== expectedSha256) {
          throw new UpdateError(
            `SHA256 mismatch for mev ${tag}: expected ${expectedSha256}, got ${actualSha256}.`,
          );
        }
        await chmod(staged, 0o755);
        const probe = await context.commands.run(staged, ['--version']);
        if (probe.code !== 0) {
          throw new UpdateError(
            formatCommandFailure(`mev ${tag} version probe failed`, probe),
          );
        }
        const reported = probe.stdout.trim();
        if (reported !== version) {
          throw new UpdateError(
            `mev ${tag} reports version '${reported}', expected '${version}'.`,
          );
        }
      },
      () => {
        committed = true;
        onCommit();
      },
    );
  } catch (error) {
    if (!committed) throw error;
    return `The updated mev command was installed, but cleanup failed: ${errorMessage(error)}`;
  }
}

async function updateMevUnchecked(
  options: UpdateOptions,
): Promise<MevUpdateOutcome> {
  const { context, currentVersion, executablePath } = options;
  const tag = await resolveLatestTag(MEV_RELEASE, context);
  const version = mevVersionFromReleaseTag(tag);
  const relation = compareReleaseVersions(currentVersion, version);
  if (relation === 'ahead') {
    return {
      kind: 'ahead',
      version: currentVersion,
      latestVersion: version,
      executablePath,
    };
  }

  const arch = await detectArch(context);
  const asset = mevReleaseAsset(arch);
  const workspace = await mkdtemp(join(context.tmpRoot, 'mev-update-'));
  let committed = false;
  let result: MevUpdateOutcome | undefined;
  try {
    await runWithCleanup(
      async () => {
        const checksumPath = join(workspace, `${asset}.sha256`);
        await downloadOverHttps(
          context.commands,
          releaseAssetDownloadUrl(
            MEV_RELEASE.repo,
            tag,
            mevReleaseAsset(arch, '.sha256'),
          ),
          checksumPath,
          `mev ${tag} checksum`,
        );
        const expectedSha256 = parseSha256Document(
          await readFile(checksumPath, 'utf8'),
          `mev ${tag}`,
          (message) => new UpdateError(message),
        );

        if (
          relation === 'same' &&
          (await sha256File(executablePath)) === expectedSha256
        ) {
          result = { kind: 'current', version, executablePath };
          return result;
        }

        const cleanupWarning = await installRelease(
          options,
          tag,
          version,
          asset,
          expectedSha256,
          () => {
            committed = true;
          },
        );
        const baseOutcome: MevUpdateOutcome =
          relation === 'newer'
            ? {
                kind: 'updated',
                previousVersion: currentVersion,
                version,
                executablePath,
              }
            : { kind: 'reinstalled', version, executablePath };
        result = cleanupWarning
          ? { ...baseOutcome, cleanupWarning }
          : baseOutcome;
        return result;
      },
      () => rm(workspace, { force: true, recursive: true }),
      `Failed to clean up mev update workspace ${workspace}.`,
    );
    return result as MevUpdateOutcome;
  } catch (error) {
    if (!committed || !result) throw error;
    return {
      ...result,
      cleanupWarning: [
        result.cleanupWarning,
        `The updated mev command was installed, but cleanup failed: ${errorMessage(error)}`,
      ]
        .filter((warning): warning is string => warning !== undefined)
        .join('; '),
    };
  }
}

export async function updateMev(
  options: UpdateOptions,
): Promise<MevUpdateOutcome> {
  try {
    return await updateMevUnchecked(options);
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(errorMessage(error));
  }
}

export async function runUpdatedSync(
  run: CommandRunner,
  executablePath: string,
  upgrade: boolean,
): Promise<number> {
  const result = await run.run(
    executablePath,
    ['sync', ...(upgrade ? ['--upgrade'] : [])],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (result.code === 127) {
    throw new UpdateError(
      formatCommandFailure('Updated mev could not start sync', result),
    );
  }
  return result.code;
}

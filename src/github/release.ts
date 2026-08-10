import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import { isNotFound } from '../host/absence';
import { replaceFileAtomically } from '../host/atomic-file';
import { runWithCleanup } from '../host/cleanup-error';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { downloadOverHttps } from '../host/https-download';
import {
  isRecord,
  parseJsonLabeled,
  requireExactKeys,
  requireNonEmptyString,
  requireRecord,
  requireUniqueBy,
} from '../host/parse';
import { loadYaml } from '../host/yaml';
import { LATEST } from '../version-pin';
import { parseRepository, type Repository, repositoryPath } from './repository';

/**
 * A prebuilt CLI binary distributed through a public GitHub Release. `repo` is
 * `owner/name`; the release asset is named `<name>-<os>-<arch>`. `tag` is either
 * an exact release tag or the reserved literal `latest`.
 */
export interface ReleaseBinary {
  readonly name: string;
  readonly repo: Repository;
  readonly tag: string;
}

const releaseArchitectures = ['aarch64', 'x86_64'] as const;
export type ReleaseArch = (typeof releaseArchitectures)[number];

/**
 * The latest-assumed tag vocabulary, matching the pnpm manifest's `latest`. An
 * entry declaring it is resolved against the repository's latest release when
 * the binary is missing or unverifiable, or when upgrade mode asks for
 * re-resolution; every other tag is an exact pin that is never re-resolved.
 */
export const latestTag = LATEST;

// Release fields flow into the public download URL, and `name` also determines
// the release asset filename. Validate the repo-owned manifest against explicit
// character sets (as `brew/install.ts` does for Homebrew tokens) so URL segments
// and asset names remain unambiguous.
const SAFE_ASSET_NAME = /^[A-Za-z0-9._+][A-Za-z0-9._+-]*$/;
const SAFE_TAG = /^[A-Za-z0-9._+][A-Za-z0-9._+-]*$/;

/** The two URLs a release entry reaches, rendered in one place. */
function latestReleaseUrl(repo: Repository): string {
  return `https://api.github.com/repos/${repositoryPath(repo)}/releases/latest`;
}

function assetDownloadUrl(
  repo: Repository,
  tag: string,
  asset: string,
): string {
  return `https://github.com/${repositoryPath(repo)}/releases/download/${tag}/${asset}`;
}

function releaseAssetName(binary: ReleaseBinary, arch: ReleaseArch): string {
  return `${binary.name}-${OS}-${arch}`;
}

export function parseReleaseBinaries(
  raw: string,
  path: string,
): ReleaseBinary[] {
  const parsed = requireRecord(
    loadYaml(raw, path),
    `Release binaries manifest ${path}`,
  );
  requireExactKeys(parsed, ['binaries'], `Release binaries manifest ${path}`);
  if (!Array.isArray(parsed['binaries'])) {
    throw new ProvisioningError(
      `Release binaries manifest must contain a binaries sequence: ${path}`,
    );
  }
  const binaries = parsed['binaries'].map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1}: entry must be a mapping.`,
      );
    }
    requireExactKeys(
      entry,
      ['name', 'repo', 'tag'],
      `Invalid release binaries manifest entry ${index + 1}`,
    );
    const entryLabel = `Invalid release binaries manifest entry ${index + 1}`;
    const name = requireNonEmptyString(entry['name'], `${entryLabel}: 'name'`);
    const named = `${entryLabel} ('${name}')`;
    const repo = parseRepository(entry['repo'], `${named}: 'repo'`);
    const tag = requireNonEmptyString(entry['tag'], `${named}: 'tag'`);
    if (!SAFE_ASSET_NAME.test(name)) {
      throw new ProvisioningError(
        `${named}: 'name' may contain only letters, digits, and ._+- and must not start with '-'.`,
      );
    }
    if (!SAFE_TAG.test(tag)) {
      throw new ProvisioningError(
        `${named}: 'tag' may contain only letters, digits, and ._+- and must not start with '-'.`,
      );
    }
    return { name, repo, tag };
  });
  requireUniqueBy(
    binaries,
    (binary) => binary.name.toLowerCase(),
    `Release binaries manifest ${path}`,
  );
  return binaries;
}

// macOS-only CLI, so the OS segment of every release asset name is fixed.
const OS = 'darwin';

const ARCH_BY_MACHINE: Readonly<Record<string, ReleaseArch>> = {
  x86_64: 'x86_64',
  arm64: 'aarch64',
};

export async function detectArch(context: Context): Promise<ReleaseArch> {
  const result = await runProcessStep(
    context.commands,
    'uname',
    ['-m'],
    'uname -m failed',
  );
  const machine = result.stdout.trim();
  const arch = ARCH_BY_MACHINE[machine];
  if (!arch) {
    throw new ProvisioningError(
      `Unsupported architecture '${machine}'. Expected one of: ${Object.keys(ARCH_BY_MACHINE).join(', ')}.`,
    );
  }
  return arch;
}

/**
 * The version a release tag denotes. Tags are published as `v<version>` while
 * the binaries report the bare version, so comparison normalizes away the one
 * optional prefix rather than requiring the two to be written identically.
 */
export function tagVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

// `<name> <version>` is clap's default `--version` rendering, which every
// declared binary uses. Only the version is compared, so a binary whose
// self-reported name differs from its manifest name or its repository (`tc`
// from `tmpc`) still matches.
const VERSION_OUTPUT = /^\S+[ \t]+(\S+)$/;

/**
 * The version the binary at `dest` reports, or null when nothing runnable is
 * installed there. A non-zero exit — a missing file, an unspawnable file, a
 * binary too broken to answer — is the not-installed signal that triggers a
 * fetch. A successful run that does not render `<name> <version>` is a contract
 * breach and fails loudly, because treating it as a mismatch would silently
 * re-download the same binary on every run forever.
 */
export async function installedVersion(
  dest: string,
  context: Context,
): Promise<string | null> {
  await repairExecuteBit(dest);
  return reportedVersion(dest, dest, context);
}

async function reportedVersion(
  path: string,
  label: string,
  context: Context,
): Promise<string | null> {
  const result = await context.commands.run(path, ['--version']);
  if (result.code !== 0) return null;
  const first = result.stdout.trim().split('\n', 1)[0]?.trim() ?? '';
  const match = VERSION_OUTPUT.exec(first);
  if (!match?.[1]) {
    throw new ProvisioningError(
      `${label} --version printed '${first}', which is not '<name> <version>'.`,
    );
  }
  return match[1];
}

// A restored backup can strip the execute bit from otherwise current bytes.
// Repairing the mode mev itself sets is cheaper than the re-download that the
// resulting spawn failure would otherwise trigger.
async function repairExecuteBit(dest: string): Promise<void> {
  let mode: number;
  try {
    mode = (await stat(dest)).mode;
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  if ((mode & 0o111) === 0) {
    await chmod(dest, mode | 0o755);
  }
}

/**
 * The tag of the repository's latest release. Reached only when a
 * `latest`-declared binary is missing or unverifiable, or upgrade mode asks for
 * re-resolution, so a routine run of a fully installed environment makes no
 * request at all. Resolution yields a concrete tag, keeping one download URL
 * shape for pinned and latest-assumed entries alike.
 */
export async function resolveLatestTag(
  binary: ReleaseBinary,
  context: Context,
): Promise<string> {
  const workspace = await mkdtemp(join(context.tmpRoot, 'mev-release-'));
  return runWithCleanup(
    async () => {
      const path = join(workspace, 'release.json');
      const label = `Latest release of ${repositoryPath(binary.repo)}`;
      await downloadOverHttps(
        context.commands,
        latestReleaseUrl(binary.repo),
        path,
        `${binary.name} latest release`,
      );
      const release = requireRecord(
        parseJsonLabeled(await readFile(path, 'utf8'), label),
        label,
      );
      const tag = release['tag_name'];
      if (typeof tag !== 'string' || !SAFE_TAG.test(tag) || tag === latestTag) {
        throw new ProvisioningError(
          `${label} reported an unusable tag_name '${String(tag)}'.`,
        );
      }
      return tag;
    },
    () => rm(workspace, { force: true, recursive: true }),
    `Failed to clean up release workspace ${workspace}.`,
  );
}

/**
 * Download the release asset `<name>-<os>-<arch>` at `tag` and install it into
 * `dest` marked executable, having confirmed that it reports the version that
 * tag denotes. The confirmation is what keeps the `--version` probe trustworthy
 * as the idempotency signal, and it runs against the staged file so a
 * mislabeled or broken asset never replaces a working binary: rejecting it
 * inside the callback leaves the rename undone and the previous `dest` intact.
 * Verifying after the swap would additionally let a bad `latest` install
 * masquerade as up to date on the next run, which skips re-resolution.
 */
export async function fetchReleaseBinary(
  binary: ReleaseBinary,
  tag: string,
  arch: ReleaseArch,
  dest: string,
  context: Context,
): Promise<void> {
  const asset = releaseAssetName(binary, arch);
  const label = `${binary.name} ${tag}`;
  await replaceFileAtomically(dest, async (tmp) => {
    const url = assetDownloadUrl(binary.repo, tag, asset);
    await downloadOverHttps(context.commands, url, tmp, binary.name);
    await chmod(tmp, 0o755);
    const reported = await reportedVersion(tmp, label, context);
    if (reported === null) {
      throw new ProvisioningError(
        `${label} downloaded from ${repositoryPath(binary.repo)} does not run.`,
      );
    }
    const expected = tagVersion(tag);
    if (reported !== expected) {
      throw new ProvisioningError(
        `${label} reports version ${reported}, expected ${expected}.`,
      );
    }
  });
}

import { chmod } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { statIfPresent } from '../host/absence';
import { replaceFileAtomically } from '../host/atomic-file';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { downloadOverHttps, hardenedCurlArgs } from '../host/https-download';
import {
  isRecord,
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
function latestReleasePageUrl(repo: Repository): string {
  return `https://github.com/${repositoryPath(repo)}/releases/latest`;
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
  const stats = await statIfPresent(dest);
  if (stats === null) return;
  if ((stats.mode & 0o111) === 0) {
    await chmod(dest, stats.mode | 0o755);
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
  const label = `Latest release of ${repositoryPath(binary.repo)}`;
  // Resolution reads the release page redirect on github.com rather than the
  // REST API: unauthenticated api.github.com is capped at 60 requests per hour
  // per IP, which one upgrade run over a few `latest` entries (plus whatever
  // else shares the IP) can exhaust. The web endpoint carries no such cap, and
  // its redirect Location names the tag directly, so no JSON parsing or
  // temporary file is involved. No `-f`: a non-redirect status must reach the
  // check below to be reported as an HTTP failure, not as a bare curl exit.
  const result = await runProcessStep(
    context.commands,
    'curl',
    [
      '-sS',
      ...hardenedCurlArgs,
      '-I',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}\t%{redirect_url}',
      '--',
      latestReleasePageUrl(binary.repo),
    ],
    `${label} request failed`,
  );
  const [status = '', redirect = ''] = result.stdout.trim().split('\t');
  if (!redirect) {
    throw new ProvisioningError(
      `${label} responded HTTP ${status} instead of redirecting to a release tag; a repository with no releases responds 404.`,
    );
  }
  return releaseTagFromRedirect(redirect, binary.repo, label);
}

/**
 * The tag named by the `releases/latest` redirect Location. The URL must sit
 * exactly under this repository's `releases/tag/` and satisfy the same tag
 * character set the manifest enforces (which also rejects percent-encoded
 * segments), so a login wall, a renamed repository, or any other unexpected
 * redirect fails loudly instead of yielding a bogus tag.
 */
export function releaseTagFromRedirect(
  redirectUrl: string,
  repo: Repository,
  label: string,
): string {
  const prefix = `https://github.com/${repositoryPath(repo)}/releases/tag/`;
  const tag = redirectUrl.startsWith(prefix)
    ? redirectUrl.slice(prefix.length)
    : null;
  if (tag === null || !SAFE_TAG.test(tag) || tag === latestTag) {
    throw new ProvisioningError(
      `${label} redirected to unusable '${redirectUrl}'.`,
    );
  }
  return tag;
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

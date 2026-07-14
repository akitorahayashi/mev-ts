import { chmod } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { replaceFileAtomically } from '../host/atomic-file';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { loadYaml } from '../host/yaml';

/**
 * A prebuilt CLI binary distributed through GitHub Releases. `repo` is
 * `owner/name`; the release asset is named `<name>-<os>-<arch>`. `private`
 * selects an authenticated `gh release download` over an anonymous `curl`, the
 * only difference being the fetch mechanism.
 */
export interface ReleaseBinary {
  readonly name: string;
  readonly repo: string;
  readonly tag: string;
  readonly private?: boolean;
}

export function parseReleaseBinaries(
  raw: string,
  path: string,
): ReleaseBinary[] {
  const parsed = loadYaml(raw) as { binaries?: unknown };
  if (!parsed?.binaries || !Array.isArray(parsed.binaries)) {
    throw new ProvisioningError(
      `Release binaries manifest must contain a binaries sequence: ${path}`,
    );
  }
  return parsed.binaries.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1}: entry must be a mapping.`,
      );
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1}: 'name' must be a non-empty string.`,
      );
    }
    if (typeof entry.repo !== 'string' || entry.repo.length === 0) {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1} ('${entry.name}'): 'repo' must be a non-empty string.`,
      );
    }
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1} ('${entry.name}'): 'tag' must be a non-empty string.`,
      );
    }
    if (entry.private !== undefined && typeof entry.private !== 'boolean') {
      throw new ProvisioningError(
        `Invalid release binaries manifest entry ${index + 1} ('${entry.name}'): 'private' must be a boolean.`,
      );
    }
    return {
      name: entry.name,
      repo: entry.repo,
      tag: entry.tag,
      private: entry.private,
    };
  });
}

// macOS-only CLI, so the OS segment of every release asset name is fixed.
const OS = 'darwin';

const ARCH_BY_MACHINE: Readonly<Record<string, string>> = {
  x86_64: 'x86_64',
  arm64: 'aarch64',
};

/** Resolve the running machine's architecture as a GitHub release asset segment. */
export async function detectArch(context: Context): Promise<string> {
  const result = await context.commands.run('uname', ['-m']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('uname -m failed', result),
    );
  }
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
 * Whether the binary already at `dest` reports `tag` from `--version`, the
 * idempotency signal that skips a re-download. Matched on a word boundary so a
 * tag of `0.6.0` does not satisfy an installed `10.6.0`. A missing binary (the
 * common first-run case, which the runner reports as `code 127`) or one that
 * cannot report its version counts as not installed.
 */
export async function installedMatches(
  dest: string,
  tag: string,
  context: Context,
): Promise<boolean> {
  const result = await context.commands.run(dest, ['--version']);
  if (result.code !== 0) return false;
  const expected = tag.replace(/^v/, '');
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(result.stdout);
}

/**
 * Download the release asset `<name>-<os>-<arch>` for `binary` into `dest` and
 * mark it executable. Private repositories require an authenticated
 * `gh release download`; public ones are fetched anonymously over HTTPS. Throws
 * with the underlying tool's stderr when the download fails.
 */
export async function fetchReleaseBinary(
  binary: ReleaseBinary,
  arch: string,
  dest: string,
  context: Context,
): Promise<void> {
  const asset = `${binary.name}-${OS}-${arch}`;
  await replaceFileAtomically(dest, async (tmp) => {
    if (binary.private) {
      const r = await context.commands.run('gh', [
        'release',
        'download',
        binary.tag,
        '--repo',
        binary.repo,
        '--pattern',
        asset,
        '--output',
        tmp,
        '--clobber',
      ]);
      if (r.code !== 0) {
        throw new ProvisioningError(
          formatCommandFailure(
            `gh release download failed for ${binary.name}`,
            r,
          ),
        );
      }
    } else {
      const url = `https://github.com/${binary.repo}/releases/download/${binary.tag}/${asset}`;
      // Pin HTTPS on the initial request and across redirects with a TLS floor,
      // so a redirect to http:// is refused rather than silently followed.
      const r = await context.commands.run('curl', [
        '-fsSL',
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--tlsv1.2',
        url,
        '-o',
        tmp,
      ]);
      if (r.code !== 0) {
        throw new ProvisioningError(
          formatCommandFailure(`curl download failed for ${binary.name}`, r),
        );
      }
    }
    await chmod(tmp, 0o755);
  });
}

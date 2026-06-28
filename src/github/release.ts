import { chmod } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { replaceFileAtomically } from '../host/atomic-file';
import { commandFailureDetail } from '../host/command';
import type { Context } from '../host/context';

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
      `uname -m failed: ${commandFailureDetail(result, `exit code ${result.code}`)}`,
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
 * common first-run case, where spawning the absent path throws ENOENT) or one
 * that cannot report its version counts as not installed.
 */
export async function installedMatches(
  dest: string,
  tag: string,
  context: Context,
): Promise<boolean> {
  let result: Awaited<ReturnType<typeof context.commands.run>>;
  try {
    result = await context.commands.run(dest, ['--version']);
  } catch {
    return false;
  }
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
          commandFailureDetail(r, `gh release download exit ${r.code}`),
        );
      }
    } else {
      const url = `https://github.com/${binary.repo}/releases/download/${binary.tag}/${asset}`;
      const r = await context.commands.run('curl', ['-fsSL', url, '-o', tmp]);
      if (r.code !== 0) {
        throw new ProvisioningError(
          commandFailureDetail(r, `curl exit ${r.code}`),
        );
      }
    }
    await chmod(tmp, 0o755);
  });
}

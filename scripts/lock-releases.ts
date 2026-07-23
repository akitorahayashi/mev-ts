/**
 * Generates `binaries.lock.yml` next to every `binaries.yml` under
 * `src/assets/config/` by downloading each declared release asset and recording
 * its SHA-256 digest. Digests already locked for a manifest's exact
 * name/repo/tag are reused, so editing one entry downloads only what changed.
 * Provisioning refuses bytes that do not match the lock, making this script the
 * reviewed path for adopting a new release.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Glob } from 'bun';
import { errorMessage } from '../src/errors';
import {
  fileSha256,
  parseReleaseBinaries,
  parseReleaseLock,
  type ReleaseArch,
  type ReleaseBinary,
  type ReleaseLock,
  releaseArchitectures,
  releaseAssetName,
  releaseLockKey,
  resolveReleaseDigest,
} from '../src/github/release';
import { readTextIfPresent } from '../src/host/absence';
import { writeFileAtomically } from '../src/host/atomic-file';
import { bunCommandRunner } from '../src/host/command';
import { downloadOverHttps } from '../src/host/https-download';
import { dumpYaml } from '../src/host/yaml';

const configRoot = join(import.meta.dir, '..', 'src', 'assets', 'config');

type DownloadReleaseBinary = (
  binary: ReleaseBinary,
  arch: ReleaseArch,
  output: string,
) => Promise<void>;

interface LockReleasesOptions {
  readonly configRoot?: string;
  readonly downloadBinary?: DownloadReleaseBinary;
  readonly log?: (message: string) => void;
}

async function downloadBinary(
  binary: ReleaseBinary,
  arch: ReleaseArch,
  output: string,
): Promise<void> {
  const asset = releaseAssetName(binary, arch);
  const url = `https://github.com/${binary.repo}/releases/download/${binary.tag}/${asset}`;
  await downloadOverHttps(bunCommandRunner, url, output, asset);
}

function lockedSha(
  lock: ReleaseLock | null,
  binary: ReleaseBinary,
  arch: ReleaseArch,
): string | null {
  if (!lock) return null;
  try {
    return resolveReleaseDigest(binary, arch, lock).sha256;
  } catch {
    // Absence of a digest is the signal to download, not a failure.
    return null;
  }
}

async function readExistingLock(path: string): Promise<ReleaseLock | null> {
  const raw = await readTextIfPresent(path);
  return raw === null ? null : parseReleaseLock(raw, path);
}

async function lockFile(
  path: string,
  root: string,
  download: DownloadReleaseBinary,
): Promise<string> {
  const raw = await readFile(path, 'utf8');
  const binaries = parseReleaseBinaries(raw, relative(root, path));
  const lockPath = releaseLockKey(path);
  const existingLock = await readExistingLock(lockPath);
  const workspace = await mkdtemp(join(tmpdir(), 'mev-release-lock-'));
  try {
    const locked = {
      binaries: await Promise.all(
        binaries.map(async (binary) => {
          const assets: Record<string, { sha256: string }> = {};
          for (const arch of releaseArchitectures) {
            const cached = lockedSha(existingLock, binary, arch);
            if (cached) {
              assets[`darwin-${arch}`] = { sha256: cached };
              continue;
            }
            const output = join(workspace, releaseAssetName(binary, arch));
            await download(binary, arch, output);
            const sha256 = await fileSha256(output);
            if (sha256 === null) {
              throw new Error(
                `Download produced no file for ${releaseAssetName(binary, arch)}.`,
              );
            }
            assets[`darwin-${arch}`] = { sha256 };
          }
          return {
            name: binary.name,
            repo: binary.repo,
            tag: binary.tag,
            assets,
          };
        }),
      ),
    };
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFileAtomically(lockPath, dumpYaml(locked));
    return lockPath;
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

export async function lockReleases(
  options: LockReleasesOptions = {},
): Promise<readonly string[]> {
  const root = options.configRoot ?? configRoot;
  const download = options.downloadBinary ?? downloadBinary;
  const log = options.log ?? console.log;
  const glob = new Glob('**/binaries.yml');
  const files: string[] = [];
  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    files.push(join(root, path));
  }
  files.sort();
  if (files.length === 0) {
    throw new Error('No release binary manifests found.');
  }
  const lockPaths: string[] = [];
  for (const path of files) {
    const lockPath = await lockFile(path, root, download);
    lockPaths.push(lockPath);
    log(`Locked ${relative(process.cwd(), lockPath)}.`);
  }
  return lockPaths;
}

if (import.meta.main) {
  try {
    await lockReleases();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}

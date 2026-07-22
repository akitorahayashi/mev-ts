import { expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lockReleases } from '../../scripts/lock-releases';
import { loadYaml } from '../../src/host/yaml';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

const AARCH64_SHA = 'a'.repeat(64);
const X86_SHA = 'b'.repeat(64);
const DOWNLOADED_SHA =
  'b7a8a844a613be796bc1892dc480f9d92c50d32a5713a87758e5c5addc4ec814';

async function writeManifest(root: string): Promise<string> {
  const dir = join(root, 'rust-cli');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'binaries.yml'),
    `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart(),
  );
  return dir;
}

test('lockReleases reuses a complete existing lock without downloading', async () => {
  await withTemporaryDirectory(
    async (root) => {
      const dir = await writeManifest(root);
      await writeFile(
        join(dir, 'binaries.lock.yml'),
        `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
    assets:
      darwin-aarch64:
        sha256: ${AARCH64_SHA}
      darwin-x86_64:
        sha256: ${X86_SHA}
`.trimStart(),
      );
      const downloads: string[] = [];

      await lockReleases({
        configRoot: root,
        async downloadBinary(binary, arch) {
          downloads.push(`${binary.name}:${arch}`);
        },
        log() {},
      });

      expect(downloads).toEqual([]);
      expect(
        loadYaml(
          await readFile(join(dir, 'binaries.lock.yml'), 'utf8'),
          'lock',
        ),
      ).toEqual({
        binaries: [
          {
            name: 'kpv',
            repo: 'akitorahayashi/kpv',
            tag: 'v0.6.0',
            assets: {
              'darwin-aarch64': { sha256: AARCH64_SHA },
              'darwin-x86_64': { sha256: X86_SHA },
            },
          },
        ],
      });
    },
    { prefix: 'release-lock-complete-' },
  );
});

test('lockReleases downloads only missing locked assets', async () => {
  await withTemporaryDirectory(
    async (root) => {
      const dir = await writeManifest(root);
      await writeFile(
        join(dir, 'binaries.lock.yml'),
        `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
    assets:
      darwin-aarch64:
        sha256: ${AARCH64_SHA}
`.trimStart(),
      );
      const downloads: string[] = [];

      await lockReleases({
        configRoot: root,
        async downloadBinary(binary, arch, output) {
          downloads.push(`${binary.name}:${arch}`);
          await writeFile(output, 'downloaded');
        },
        log() {},
      });

      expect(downloads).toEqual(['kpv:x86_64']);
      expect(
        loadYaml(
          await readFile(join(dir, 'binaries.lock.yml'), 'utf8'),
          'lock',
        ),
      ).toEqual({
        binaries: [
          {
            name: 'kpv',
            repo: 'akitorahayashi/kpv',
            tag: 'v0.6.0',
            assets: {
              'darwin-aarch64': { sha256: AARCH64_SHA },
              'darwin-x86_64': { sha256: DOWNLOADED_SHA },
            },
          },
        ],
      });
    },
    { prefix: 'release-lock-missing-' },
  );
});

test('lockReleases discards a stale digest when the tag changes', async () => {
  await withTemporaryDirectory(
    async (root) => {
      const dir = await writeManifest(root);
      await writeFile(
        join(dir, 'binaries.lock.yml'),
        `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.5.0
    assets:
      darwin-aarch64:
        sha256: ${AARCH64_SHA}
      darwin-x86_64:
        sha256: ${X86_SHA}
`.trimStart(),
      );
      const downloads: string[] = [];

      await lockReleases({
        configRoot: root,
        async downloadBinary(binary, arch, output) {
          downloads.push(`${binary.name}:${arch}`);
          await writeFile(output, 'downloaded');
        },
        log() {},
      });

      expect(downloads).toEqual(['kpv:aarch64', 'kpv:x86_64']);
      expect(
        loadYaml(
          await readFile(join(dir, 'binaries.lock.yml'), 'utf8'),
          'lock',
        ),
      ).toEqual({
        binaries: [
          {
            name: 'kpv',
            repo: 'akitorahayashi/kpv',
            tag: 'v0.6.0',
            assets: {
              'darwin-aarch64': { sha256: DOWNLOADED_SHA },
              'darwin-x86_64': { sha256: DOWNLOADED_SHA },
            },
          },
        ],
      });
    },
    { prefix: 'release-lock-stale-' },
  );
});

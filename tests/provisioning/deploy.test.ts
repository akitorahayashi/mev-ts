import { expect } from 'bun:test';
import { chmod, lstat, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir, deployedPath } from '../../src/assets/ref';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { deployRole } from '../../src/provisioning/deploy';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const ALL_KEYS = ['git/global/.gitconfig', 'git/global/.gitignore_global'];
const EXECUTABLE_KEY = 'git/global/post-commit.sh';

const assets: AssetSource = {
  async read(key) {
    return `content of ${key}\n`;
  },
  keysByPrefix(prefix) {
    return [...ALL_KEYS, EXECUTABLE_KEY].filter((key) =>
      key.startsWith(prefix),
    );
  },
  isExecutable(key) {
    return key === EXECUTABLE_KEY;
  },
};

const sandboxTest = sandboxedTest('deploy-');

const contextFor = (homeDir: string): Context =>
  recordingContext({ home: homeDir, assets }).context;

sandboxTest(
  'deployRole materializes every asset under the role',
  async (sandbox) => {
    const result = await deployRole('git', contextFor(sandbox));

    expect(result.deployed).toBe(true);
    for (const key of ALL_KEYS) {
      expect(await Bun.file(deployedPath({ key }, sandbox)).text()).toBe(
        `content of ${key}\n`,
      );
    }
  },
);

sandboxTest(
  'deployRole restores the owner-execute bit for executable assets',
  async (sandbox) => {
    await deployRole('git', contextFor(sandbox));

    const executable = await stat(
      deployedPath({ key: EXECUTABLE_KEY }, sandbox),
    );
    expect(executable.mode & 0o100).not.toBe(0);

    const plain = await stat(
      deployedPath({ key: 'git/global/.gitconfig' }, sandbox),
    );
    expect(plain.mode & 0o100).toBe(0);
  },
);

sandboxTest('deployRole regenerates a present role', async (sandbox) => {
  await deployRole('git', contextFor(sandbox));
  const deployed = deployedPath({ key: 'git/global/.gitconfig' }, sandbox);
  await writeFile(deployed, 'stale');

  const result = await deployRole('git', contextFor(sandbox));

  expect(result.deployed).toBe(true);
  expect(await Bun.file(deployed).text()).toBe(
    'content of git/global/.gitconfig\n',
  );
});

sandboxTest(
  'deployRole leaves an equivalent role in place',
  async (sandbox) => {
    await deployRole('git', contextFor(sandbox));
    const dest = deployedDir('git', sandbox);
    const before = await stat(dest);

    const result = await deployRole('git', contextFor(sandbox));

    expect(result.deployed).toBe(false);
    expect((await stat(dest)).ino).toBe(before.ino);
  },
);

sandboxTest('deployRole repairs executable-mode drift', async (sandbox) => {
  await deployRole('git', contextFor(sandbox));
  const executable = deployedPath({ key: EXECUTABLE_KEY }, sandbox);
  await chmod(executable, 0o644);

  const result = await deployRole('git', contextFor(sandbox));

  expect(result.deployed).toBe(true);
  expect((await stat(executable)).mode & 0o100).not.toBe(0);
});

sandboxTest(
  'deployRole skips roles with no embedded assets',
  async (sandbox) => {
    const result = await deployRole('assetless', contextFor(sandbox));

    expect(result).toEqual({ role: 'assetless', deployed: false, files: [] });
    expect(await Bun.file(deployedDir('assetless', sandbox)).exists()).toBe(
      false,
    );
  },
);

sandboxTest('deployRole clears a present assetless role', async (sandbox) => {
  const dest = deployedDir('assetless', sandbox);
  const stale = join(dest, 'global/stale.txt');
  await mkdir(join(dest, 'global'), { recursive: true });
  await writeFile(stale, 'leftover');

  const result = await deployRole('assetless', contextFor(sandbox));

  expect(result).toEqual({ role: 'assetless', deployed: true, files: [] });
  expect((await lstat(dest)).isDirectory()).toBe(true);
  await expect(lstat(stale)).rejects.toThrow();
});

sandboxTest('deployRole prunes stale files', async (sandbox) => {
  await deployRole('git', contextFor(sandbox));
  const stale = join(deployedDir('git', sandbox), 'global/stale.txt');
  await writeFile(stale, 'leftover');

  const result = await deployRole('git', contextFor(sandbox));

  expect(result.deployed).toBe(true);
  await expect(lstat(stale)).rejects.toThrow();
});

sandboxTest(
  'deployRole keeps the previous role when replacement staging fails',
  async (sandbox) => {
    await deployRole('git', contextFor(sandbox));
    const stale = join(deployedDir('git', sandbox), 'global/stale.txt');
    await writeFile(stale, 'leftover');

    const failingAssets: AssetSource = {
      ...assets,
      async read(key) {
        if (key === 'git/global/.gitignore_global') {
          throw new Error('asset unavailable');
        }
        return assets.read(key);
      },
    };

    await expect(
      deployRole('git', {
        ...contextFor(sandbox),
        assets: failingAssets,
      }),
    ).rejects.toThrow('asset unavailable');

    expect(
      await Bun.file(
        deployedPath({ key: 'git/global/.gitconfig' }, sandbox),
      ).text(),
    ).toBe('content of git/global/.gitconfig\n');
    expect(await Bun.file(stale).text()).toBe('leftover');
  },
);

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { lstat, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir, deployedPath } from '../../src/assets/ref';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { deployRole } from '../../src/provisioning/deploy';

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

let counter = 0;
let sandbox: string;

function contextFor(homeDir: string, overwrite = false): Context {
  return {
    home: homeDir,
    overwrite,
    commands: {
      async run() {
        return { code: 0, stdout: '', stderr: '' };
      },
    },
    assets,
  };
}

beforeEach(async () => {
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `deploy-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

test('deployRole materializes every asset under the role', async () => {
  const result = await deployRole('git', contextFor(sandbox));

  expect(result.deployed).toBe(true);
  for (const key of ALL_KEYS) {
    expect(await Bun.file(deployedPath({ key }, sandbox)).text()).toBe(
      `content of ${key}\n`,
    );
  }
});

test('deployRole restores the owner-execute bit for executable assets', async () => {
  await deployRole('git', contextFor(sandbox));

  const executable = await stat(deployedPath({ key: EXECUTABLE_KEY }, sandbox));
  expect(executable.mode & 0o100).not.toBe(0);

  const plain = await stat(
    deployedPath({ key: 'git/global/.gitconfig' }, sandbox),
  );
  expect(plain.mode & 0o100).toBe(0);
});

test('deployRole skips a present role without overwrite', async () => {
  await deployRole('git', contextFor(sandbox));
  const result = await deployRole('git', contextFor(sandbox, false));
  expect(result.deployed).toBe(false);
});

test('deployRole skips roles with no embedded assets', async () => {
  const result = await deployRole('assetless', contextFor(sandbox));

  expect(result).toEqual({ role: 'assetless', deployed: false, files: [] });
  expect(await Bun.file(deployedDir('assetless', sandbox)).exists()).toBe(
    false,
  );
});

test('deployRole clears a present assetless role when overwrite is set', async () => {
  const dest = deployedDir('assetless', sandbox);
  const stale = join(dest, 'global/stale.txt');
  await mkdir(join(dest, 'global'), { recursive: true });
  await writeFile(stale, 'leftover');

  const result = await deployRole('assetless', contextFor(sandbox, true));

  expect(result).toEqual({ role: 'assetless', deployed: true, files: [] });
  expect((await lstat(dest)).isDirectory()).toBe(true);
  await expect(lstat(stale)).rejects.toThrow();
});

test('deployRole prunes stale files when overwrite is set', async () => {
  await deployRole('git', contextFor(sandbox));
  const stale = join(deployedDir('git', sandbox), 'global/stale.txt');
  await writeFile(stale, 'leftover');

  const result = await deployRole('git', contextFor(sandbox, true));

  expect(result.deployed).toBe(true);
  await expect(lstat(stale)).rejects.toThrow();
});

test('deployRole keeps the previous role when overwrite staging fails', async () => {
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
      ...contextFor(sandbox, true),
      assets: failingAssets,
    }),
  ).rejects.toThrow('asset unavailable');

  expect(
    await Bun.file(
      deployedPath({ key: 'git/global/.gitconfig' }, sandbox),
    ).text(),
  ).toBe('content of git/global/.gitconfig\n');
  expect(await Bun.file(stale).text()).toBe('leftover');
});

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployedDir, deployedPath } from '../../src/assets/ref';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { deployRole, inspectRole } from '../../src/provisioning/deploy';

const ALL_KEYS = ['git/global/.gitconfig', 'git/global/.gitignore_global'];

const assets: AssetSource = {
  async read(key) {
    return `content of ${key}\n`;
  },
  keysByPrefix(prefix) {
    return ALL_KEYS.filter((key) => key.startsWith(prefix));
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

test('deployRole skips a present role without overwrite', async () => {
  await deployRole('git', contextFor(sandbox));
  const result = await deployRole('git', contextFor(sandbox, false));
  expect(result.deployed).toBe(false);
});

test('deployRole prunes stale files when overwrite is set', async () => {
  await deployRole('git', contextFor(sandbox));
  const stale = join(deployedDir('git', sandbox), 'global/stale.txt');
  await writeFile(stale, 'leftover');

  const result = await deployRole('git', contextFor(sandbox, true));

  expect(result.deployed).toBe(true);
  await expect(lstat(stale)).rejects.toThrow();
});

test('inspectRole reports would-deploy without writing', async () => {
  const result = await inspectRole('git', contextFor(sandbox));
  expect(result.deployed).toBe(true);
  await expect(lstat(deployedDir('git', sandbox))).rejects.toThrow();
});

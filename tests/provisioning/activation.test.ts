import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { asset, deployedDir, deployedPath } from '../../src/assets/ref';
import type { AssetSource } from '../../src/assets/registry';
import type { Context } from '../../src/host/context';
import { home } from '../../src/host/path';
import {
  link,
  linkTree,
  runActivation,
} from '../../src/provisioning/activation';

const aliasPrefix = 'shell/global/alias/';
const ALIAS_KEYS = [`${aliasPrefix}a.zsh`, `${aliasPrefix}sub/b.zsh`];
const ALL_KEYS = ['git/global/.gitconfig', ...ALIAS_KEYS];

const assets: AssetSource = {
  async read(key) {
    return `content of ${key}\n`;
  },
  keysByPrefix(prefix) {
    return ALL_KEYS.filter((key) => key.startsWith(prefix));
  },
  isExecutable() {
    return false;
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

async function deploy(context: Context, key: string) {
  const dest = deployedPath({ key }, context.home);
  await mkdir(join(dest, '..'), { recursive: true });
  await writeFile(dest, await context.assets.read(key));
}

beforeEach(async () => {
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `activate-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

test('link creates a symlink to the deployed asset and is idempotent', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  await deploy(context, ref.key);
  const activation = link(ref, home('.config/git/config'));

  const first = await runActivation(activation, context);
  expect(first.status).toBe('changed');
  expect(first.verb).toBe('link');
  expect(await readlink(join(sandbox, '.config/git/config'))).toBe(
    deployedPath(ref, sandbox),
  );

  const second = await runActivation(activation, context);
  expect(second.status).toBe('unchanged');
});

test('link refuses to replace an unmanaged file without overwrite', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  await deploy(context, ref.key);
  await writeFile(join(sandbox, '.config-target'), 'user content');

  const report = await runActivation(
    link(ref, home('.config-target')),
    context,
  );
  expect(report.status).toBe('failed');
  expect(report.error).toContain('--overwrite');
});

test('link replaces an unmanaged file when overwrite is set', async () => {
  const context = contextFor(sandbox, true);
  const ref = asset('git/global/.gitconfig');
  await deploy(context, ref.key);
  const dest = join(sandbox, '.config-target');
  await writeFile(dest, 'user content');

  const report = await runActivation(
    link(ref, home('.config-target')),
    context,
  );
  expect(report.status).toBe('changed');
  expect(await readlink(dest)).toBe(deployedPath(ref, sandbox));
});

test('link surfaces filesystem errors while probing links', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  await deploy(context, ref.key);
  await writeFile(join(sandbox, '.blocked'), 'not a directory');

  const report = await runActivation(
    link(ref, home('.blocked/git/config')),
    context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toMatch(/not a directory/i);
});

test('linkTree mirrors deployed assets as symlinks and is idempotent', async () => {
  const context = contextFor(sandbox);
  for (const key of ALIAS_KEYS) await deploy(context, key);
  const activation = linkTree(aliasPrefix, home('.mev/alias'));

  const first = await runActivation(activation, context);
  expect(first.status).toBe('changed');
  expect(await readlink(join(sandbox, '.mev/alias/a.zsh'))).toBe(
    deployedPath(asset(`${aliasPrefix}a.zsh`), sandbox),
  );
  expect(await readlink(join(sandbox, '.mev/alias/sub/b.zsh'))).toBe(
    deployedPath(asset(`${aliasPrefix}sub/b.zsh`), sandbox),
  );

  const second = await runActivation(activation, context);
  expect(second.status).toBe('unchanged');
});

test('linkTree prunes a managed link that is no longer expected', async () => {
  const context = contextFor(sandbox);
  for (const key of ALIAS_KEYS) await deploy(context, key);
  const activation = linkTree(aliasPrefix, home('.mev/alias'));
  await runActivation(activation, context);

  const stale = join(sandbox, '.mev/alias/removed.zsh');
  await symlink(join(deployedDir(aliasPrefix, sandbox), 'removed.zsh'), stale);

  expect((await runActivation(activation, context)).status).toBe('changed');
  await expect(lstat(stale)).rejects.toThrow();
});

test('linkTree leaves unmanaged files and foreign links untouched', async () => {
  const context = contextFor(sandbox);
  for (const key of ALIAS_KEYS) await deploy(context, key);
  const activation = linkTree(aliasPrefix, home('.mev/alias'));
  await runActivation(activation, context);

  const userFile = join(sandbox, '.mev/alias/custom.zsh');
  await writeFile(userFile, 'user content');
  const foreignLink = join(sandbox, '.mev/alias/foreign.zsh');
  await symlink(join(sandbox, 'elsewhere/x.zsh'), foreignLink);

  await runActivation(activation, context);

  expect(await Bun.file(userFile).text()).toBe('user content');
  expect(await readlink(foreignLink)).toBe(join(sandbox, 'elsewhere/x.zsh'));
});

test('linkTree only replaces expected links that drifted', async () => {
  const context = contextFor(sandbox);
  for (const key of ALIAS_KEYS) await deploy(context, key);
  const activation = linkTree(aliasPrefix, home('.mev/alias'));
  await runActivation(activation, context);

  const correct = join(sandbox, '.mev/alias/a.zsh');
  const drifted = join(sandbox, '.mev/alias/sub/b.zsh');
  const before = await lstat(correct);
  await rm(drifted);
  await symlink(join(sandbox, 'wrong-target'), drifted);

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect((await lstat(correct)).ino).toBe(before.ino);
  expect(await readlink(drifted)).toBe(
    deployedPath(asset(`${aliasPrefix}sub/b.zsh`), sandbox),
  );
});

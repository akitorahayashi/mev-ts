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
import { ProvisioningError } from '../../src/errors';
import { fs } from '../../src/providers/filesystem';
import { asset, deployedDir, deployedPath } from '../../src/resources/asset';
import type { Context } from '../../src/resources/model';
import { home } from '../../src/resources/path';

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
    assets: {
      async read(key) {
        return `content of ${key}\n`;
      },
    },
  };
}

beforeEach(async () => {
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `fs-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

test('deployAsset materializes embedded content and is idempotent', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  const resource = fs.deployAsset(ref);

  expect((await resource.inspect(context)).kind).toBe('missing');
  await resource.apply(context);

  const written = await Bun.file(deployedPath(ref, sandbox)).text();
  expect(written).toBe('content of git/global/.gitconfig\n');
  expect((await resource.inspect(context)).kind).toBe('present');
});

test('directory inspect transitions from missing to present after apply', async () => {
  const context = contextFor(sandbox);
  const resource = fs.directory(home('.config/git'));

  expect((await resource.inspect(context)).kind).toBe('missing');
  await resource.apply(context);
  expect((await resource.inspect(context)).kind).toBe('present');
});

test('symlink points at the deployed asset and is idempotent', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  await fs.deployAsset(ref).apply(context);

  const link = fs.symlink(ref, home('.config/git/config'));
  expect((await link.inspect(context)).kind).toBe('missing');
  await link.apply(context);

  const linkPath = join(sandbox, '.config/git/config');
  expect(await readlink(linkPath)).toBe(deployedPath(ref, sandbox));
  expect((await link.inspect(context)).kind).toBe('present');
});

test('symlink refuses to replace an unmanaged file without overwrite', async () => {
  const context = contextFor(sandbox);
  const ref = asset('git/global/.gitconfig');
  await fs.deployAsset(ref).apply(context);

  const linkPath = join(sandbox, '.gitignore_global');
  await writeFile(linkPath, 'user content');

  const link = fs.symlink(ref, home('.gitignore_global'));
  expect((await link.inspect(context)).kind).toBe('diverged');
  await expect(link.apply(context)).rejects.toBeInstanceOf(ProvisioningError);
});

test('symlink replaces an unmanaged file when overwrite is set', async () => {
  const context = contextFor(sandbox, true);
  const ref = asset('git/global/.gitconfig');
  await fs.deployAsset(ref).apply(context);

  const linkPath = join(sandbox, '.gitignore_global');
  await writeFile(linkPath, 'user content');

  const link = fs.symlink(ref, home('.gitignore_global'));
  await link.apply(context);
  expect(await readlink(linkPath)).toBe(deployedPath(ref, sandbox));
});

const aliasPrefix = 'shell/global/alias/';
const aliasA = asset(`${aliasPrefix}a.zsh`);
const aliasB = asset(`${aliasPrefix}sub/b.zsh`);
const aliasRefs = [aliasA, aliasB];

async function deployAll(context: Context) {
  for (const ref of aliasRefs) {
    await fs.deployAsset(ref).apply(context);
  }
}

test('linkTree mirrors deployed assets as symlinks and is idempotent', async () => {
  const context = contextFor(sandbox);
  await deployAll(context);
  const tree = fs.linkTree(home('.mev/alias'), aliasRefs, aliasPrefix);

  expect((await tree.inspect(context)).kind).toBe('missing');
  await tree.apply(context);

  expect(await readlink(join(sandbox, '.mev/alias/a.zsh'))).toBe(
    deployedPath(aliasA, sandbox),
  );
  expect(await readlink(join(sandbox, '.mev/alias/sub/b.zsh'))).toBe(
    deployedPath(aliasB, sandbox),
  );
  expect((await tree.inspect(context)).kind).toBe('present');
});

test('linkTree prunes a managed link that is no longer expected', async () => {
  const context = contextFor(sandbox);
  await deployAll(context);
  const tree = fs.linkTree(home('.mev/alias'), aliasRefs, aliasPrefix);
  await tree.apply(context);

  // A link pointing into the deploy root but absent from the expected set.
  const stale = join(sandbox, '.mev/alias/removed.zsh');
  await symlink(join(deployedDir(aliasPrefix, sandbox), 'removed.zsh'), stale);

  expect((await tree.inspect(context)).kind).toBe('diverged');
  await tree.apply(context);
  await expect(lstat(stale)).rejects.toThrow();
  expect((await tree.inspect(context)).kind).toBe('present');
});

test('linkTree leaves unmanaged files and foreign links untouched', async () => {
  const context = contextFor(sandbox);
  await deployAll(context);
  const tree = fs.linkTree(home('.mev/alias'), aliasRefs, aliasPrefix);
  await tree.apply(context);

  const userFile = join(sandbox, '.mev/alias/custom.zsh');
  await writeFile(userFile, 'user content');
  const foreignLink = join(sandbox, '.mev/alias/foreign.zsh');
  await symlink(join(sandbox, 'elsewhere/x.zsh'), foreignLink);

  await tree.apply(context);

  expect(await Bun.file(userFile).text()).toBe('user content');
  expect(await readlink(foreignLink)).toBe(join(sandbox, 'elsewhere/x.zsh'));
});

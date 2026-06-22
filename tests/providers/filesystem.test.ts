import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, readlink, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/mev/errors';
import { fs } from '../../src/mev/providers/filesystem';
import { asset, deployedPath } from '../../src/mev/resources/asset';
import type { Context } from '../../src/mev/resources/model';
import { home } from '../../src/mev/resources/path';

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

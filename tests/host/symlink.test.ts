import { expect } from 'bun:test';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  isSymlinkTo,
  materializeSymlink,
  placeSymlink,
} from '../../src/host/symlink';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandbox = sandboxedTest('mev-symlink-');

async function ownedSiblings(path: string): Promise<string[]> {
  const prefix = `.${basename(path)}.`;
  return (await readdir(dirname(path))).filter((name) =>
    name.startsWith(prefix),
  );
}

sandbox('places a symlink at an unoccupied destination', async (dir) => {
  const link = join(dir, 'link');
  const target = join(dir, 'target-file');
  await writeFile(target, 'contents');

  await placeSymlink(link, target);

  expect(await readlink(link)).toBe(target);
  expect(await isSymlinkTo(link, target)).toBe(true);
  expect(await ownedSiblings(link)).toEqual([]);
});

sandbox(
  'isSymlinkTo distinguishes a matching link from every other state',
  async (dir) => {
    const target = join(dir, 'target');
    await writeFile(target, 'contents');

    expect(await isSymlinkTo(join(dir, 'absent'), target)).toBe(false);

    const regular = join(dir, 'regular');
    await writeFile(regular, 'contents');
    expect(await isSymlinkTo(regular, target)).toBe(false);

    const wrong = join(dir, 'wrong');
    await symlink(join(dir, 'other'), wrong);
    expect(await isSymlinkTo(wrong, target)).toBe(false);

    const correct = join(dir, 'correct');
    await symlink(target, correct);
    expect(await isSymlinkTo(correct, target)).toBe(true);
  },
);

sandbox('replaces an existing symlink that points elsewhere', async (dir) => {
  const link = join(dir, 'link');
  const target = join(dir, 'target');
  await writeFile(target, 'contents');
  await symlink(join(dir, 'stale'), link);

  await placeSymlink(link, target);

  expect(await isSymlinkTo(link, target)).toBe(true);
  expect(await ownedSiblings(link)).toEqual([]);
});

sandbox('replaces an existing regular file with the symlink', async (dir) => {
  const link = join(dir, 'link');
  const target = join(dir, 'target');
  await writeFile(target, 'contents');
  await writeFile(link, 'previous');

  await placeSymlink(link, target);

  expect(await isSymlinkTo(link, target)).toBe(true);
  expect(await ownedSiblings(link)).toEqual([]);
});

sandbox(
  'replaces an existing directory and clears its staging siblings',
  async (dir) => {
    const link = join(dir, 'link');
    const target = join(dir, 'target');
    await writeFile(target, 'contents');
    await mkdir(link);
    await writeFile(join(link, 'inside.txt'), 'data');

    await placeSymlink(link, target);

    expect(await isSymlinkTo(link, target)).toBe(true);
    expect(await ownedSiblings(link)).toEqual([]);
  },
);

sandbox(
  'fails closed without touching the destination when the parent is not writable',
  async (dir) => {
    const link = join(dir, 'link');
    const target = join(dir, 'target');
    await writeFile(target, 'contents');
    const previous = join(dir, 'previous');
    await symlink(previous, link);

    await chmod(dir, 0o500);
    try {
      await expect(placeSymlink(link, target)).rejects.toThrow();
      expect(await readlink(link)).toBe(previous);
    } finally {
      await chmod(dir, 0o700);
    }

    expect(await ownedSiblings(link)).toEqual([]);
  },
);

sandbox('materializes a symlink into a regular file', async (dir) => {
  const link = join(dir, 'config.toml');
  const target = join(dir, 'store.toml');
  await writeFile(target, 'runtime = true\n');
  await symlink(target, link);

  expect(await materializeSymlink(link)).toBe(true);

  expect((await lstat(link)).isSymbolicLink()).toBe(false);
  expect(await readFile(link, 'utf8')).toBe('runtime = true\n');
  // Later writes through the former link no longer reach the target.
  await writeFile(link, 'detached = true\n');
  expect(await readFile(target, 'utf8')).toBe('runtime = true\n');
});

sandbox('leaves a regular file and a dangling link untouched', async (dir) => {
  const regular = join(dir, 'regular');
  await writeFile(regular, 'kept');
  const dangling = join(dir, 'dangling');
  await symlink(join(dir, 'missing'), dangling);

  expect(await materializeSymlink(regular)).toBe(false);
  expect(await materializeSymlink(dangling)).toBe(false);

  expect(await readFile(regular, 'utf8')).toBe('kept');
  expect((await lstat(dangling)).isSymbolicLink()).toBe(true);
});

import { expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { replaceDirectoryAfterBuild } from '../../src/host/directory-replacement';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

async function runOwnedSiblings(path: string): Promise<string[]> {
  const prefix = `.${basename(path)}.`;
  return (await readdir(dirname(path))).filter((name) =>
    name.startsWith(prefix),
  );
}

test('installs a fully built directory without residual siblings', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');

    await replaceDirectoryAfterBuild(dest, async (staging) => {
      await writeFile(join(staging, 'file.txt'), 'new');
    });

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('new');
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('replaces an existing directory and removes stale contents', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'stale.txt'), 'old');

    await replaceDirectoryAfterBuild(dest, async (staging) => {
      await writeFile(join(staging, 'file.txt'), 'new');
    });

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('new');
    expect(await Bun.file(join(dest, 'stale.txt')).exists()).toBe(false);
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('leaves an equivalent existing directory in place', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'file.txt'), 'same');
    const before = await stat(dest);

    const replaced = await replaceDirectoryAfterBuild(dest, async (staging) => {
      await writeFile(join(staging, 'file.txt'), 'same');
    });

    expect(replaced).toBe(false);
    expect((await stat(dest)).ino).toBe(before.ino);
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('keeps the previous directory when staging fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'file.txt'), 'old');

    await expect(
      replaceDirectoryAfterBuild(dest, async (staging) => {
        await writeFile(join(staging, 'partial.txt'), 'partial');
        throw new Error('build failed');
      }),
    ).rejects.toThrow('build failed');

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('old');
    expect(await Bun.file(join(dest, 'partial.txt')).exists()).toBe(false);
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('does not treat a build rejection without a reason as success', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    let rejected = false;
    let reason: unknown = 'unset';

    try {
      await replaceDirectoryAfterBuild(dest, async () => {
        await Promise.reject();
      });
    } catch (error) {
      rejected = true;
      reason = error;
    }

    expect(rejected).toBe(true);
    expect(reason).toBeUndefined();
    expect(await Bun.file(dest).exists()).toBe(false);
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('preserves the build failure when cleanup also fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    const primary = new Error('build failed');
    let caught: unknown;

    try {
      await replaceDirectoryAfterBuild(dest, async () => {
        await chmod(dir, 0o500);
        throw primary;
      });
    } catch (error) {
      caught = error;
    } finally {
      await chmod(dir, 0o700);
    }

    expect(caught).toBe(primary);
    expect(
      (primary as Error & { cleanupError?: unknown }).cleanupError,
    ).toBeDefined();
    expect(Object.keys(primary)).toContain('cleanupError');
  });
});

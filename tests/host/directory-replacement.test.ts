import { expect, test } from 'bun:test';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { replaceDirectoryAfterBuild } from '../../src/host/directory-replacement';
import { stagingSiblings } from '../fixtures/path-probe';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('generic directory equivalence still compares the complete executable-bit mask', async () => {
  await withTemporaryDirectory(async (home) => {
    const dest = join(home, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'script'), 'same bytes', { mode: 0o755 });
    const build = async (stage: string) => {
      await writeFile(join(stage, 'script'), 'same bytes', { mode: 0o700 });
    };
    expect(await replaceDirectoryAfterBuild(dest, build, { home })).toBe(true);
    expect((await stat(join(dest, 'script'))).mode & 0o111).toBe(0o100);
    expect(await replaceDirectoryAfterBuild(dest, build, { home })).toBe(false);
  });
});

test('installs a fully built directory without residual siblings', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');

    await replaceDirectoryAfterBuild(
      dest,
      async (staging) => {
        await writeFile(join(staging, 'file.txt'), 'new');
      },
      { home: dir },
    );

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('new');
    expect(await stagingSiblings(dest)).toEqual([]);
  });
});

test('replaces an existing directory and removes stale contents', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'stale.txt'), 'old');

    await replaceDirectoryAfterBuild(
      dest,
      async (staging) => {
        await writeFile(join(staging, 'file.txt'), 'new');
      },
      { home: dir },
    );

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('new');
    expect(await Bun.file(join(dest, 'stale.txt')).exists()).toBe(false);
    expect(await stagingSiblings(dest)).toEqual([]);
  });
});

test('leaves an equivalent existing directory in place', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'file.txt'), 'same');
    const before = await stat(dest);

    const replaced = await replaceDirectoryAfterBuild(
      dest,
      async (staging) => {
        await writeFile(join(staging, 'file.txt'), 'same');
      },
      { home: dir },
    );

    expect(replaced).toBe(false);
    expect((await stat(dest)).ino).toBe(before.ino);
    expect(await stagingSiblings(dest)).toEqual([]);
  });
});

test('keeps the previous directory when staging fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    await mkdir(dest);
    await writeFile(join(dest, 'file.txt'), 'old');

    await expect(
      replaceDirectoryAfterBuild(
        dest,
        async (staging) => {
          await writeFile(join(staging, 'partial.txt'), 'partial');
          throw new Error('build failed');
        },
        { home: dir },
      ),
    ).rejects.toThrow('build failed');

    expect(await readFile(join(dest, 'file.txt'), 'utf8')).toBe('old');
    expect(await Bun.file(join(dest, 'partial.txt')).exists()).toBe(false);
    expect(await stagingSiblings(dest)).toEqual([]);
  });
});

test('does not treat a build rejection without a reason as success', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    let rejected = false;
    let reason: unknown = 'unset';

    try {
      await replaceDirectoryAfterBuild(
        dest,
        async () => {
          await Promise.reject();
        },
        { home: dir },
      );
    } catch (error) {
      rejected = true;
      reason = error;
    }

    expect(rejected).toBe(true);
    expect(reason).toBeUndefined();
    expect(await Bun.file(dest).exists()).toBe(false);
    expect(await stagingSiblings(dest)).toEqual([]);
  });
});

test('preserves the build failure when cleanup also fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'role');
    const primary = new Error('build failed');
    let caught: unknown;

    try {
      await replaceDirectoryAfterBuild(
        dest,
        async () => {
          await chmod(dir, 0o500);
          throw primary;
        },
        { home: dir },
      );
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

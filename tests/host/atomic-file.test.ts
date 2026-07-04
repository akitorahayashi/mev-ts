import { expect, test } from 'bun:test';
import {
  chmod,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  replaceFileAtomically,
  writeFileAtomically,
} from '../../src/host/atomic-file';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

async function runOwnedSiblings(path: string): Promise<string[]> {
  const prefix = `.${basename(path)}.`;
  return (await readdir(dirname(path))).filter((name) =>
    name.startsWith(prefix),
  );
}

test('writes the final file without leaving transaction siblings', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'state.json');

    await writeFileAtomically(dest, '{"ok":true}\n');

    expect(await readFile(dest, 'utf8')).toBe('{"ok":true}\n');
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('keeps an existing destination when the writer fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'state.json');
    await writeFile(dest, 'old');

    await expect(
      replaceFileAtomically(dest, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');

    expect(await readFile(dest, 'utf8')).toBe('old');
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('does not treat a writer rejection without a reason as success', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'state.json');
    let rejected = false;
    let reason: unknown = 'unset';

    try {
      await replaceFileAtomically(dest, async () => {
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

test('lends a named path inside a private destination-adjacent directory', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'tool');
    let observed = '';

    await replaceFileAtomically(dest, async (tmp) => {
      observed = tmp;
      await writeFile(tmp, 'downloaded', { flag: 'wx' });
    });

    expect(dirname(dirname(observed))).toBe(await realpath(dir));
    expect(basename(dirname(observed)).startsWith('.tool.')).toBe(true);
    expect(await readFile(dest, 'utf8')).toBe('downloaded');
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('fails closed when the borrowed output path is substituted with a symlink', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'state.json');
    const foreign = join(dir, 'foreign.json');
    await writeFile(dest, 'old');
    await writeFile(foreign, 'foreign');

    await expect(
      replaceFileAtomically(dest, async (tmp) => {
        await symlink(foreign, tmp);
        await writeFile(tmp, 'new', { flag: 'wx' });
      }),
    ).rejects.toThrow();

    expect(await readFile(dest, 'utf8')).toBe('old');
    expect(await readFile(foreign, 'utf8')).toBe('foreign');
    expect(await runOwnedSiblings(dest)).toEqual([]);
  });
});

test('preserves the writer failure when cleanup also fails', async () => {
  await withTemporaryDirectory(async (dir) => {
    const dest = join(dir, 'state.json');
    const primary = new Error('write failed');
    let parent = '';
    let caught: unknown;

    try {
      await replaceFileAtomically(dest, async (tmp) => {
        parent = dirname(dirname(tmp));
        await chmod(parent, 0o500);
        throw primary;
      });
    } catch (error) {
      caught = error;
    } finally {
      if (parent) await chmod(parent, 0o700);
    }

    expect(caught).toBe(primary);
    expect(
      (primary as Error & { cleanupError?: unknown }).cleanupError,
    ).toBeDefined();
    expect(Object.keys(primary)).toContain('cleanupError');
  });
});

import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTemporaryDirectory } from './temporary-directory';

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

test('allocates each directory under the system temporary root', async () => {
  let observed = '';

  await withTemporaryDirectory(
    async (dir) => {
      observed = dir;
      expect(await exists(dir)).toBe(true);
    },
    { prefix: 'fixture-root-' },
  );

  expect(observed.startsWith(join(tmpdir(), 'fixture-root-'))).toBe(true);
  expect(await exists(observed)).toBe(false);
});

test('allocates distinct directories for parallel and repeated runs', async () => {
  const dirs = await Promise.all(
    Array.from({ length: 8 }, () =>
      withTemporaryDirectory(async (dir) => dir, { prefix: 'fixture-many-' }),
    ),
  );

  expect(new Set(dirs).size).toBe(dirs.length);
  for (const dir of dirs) {
    expect(await exists(dir)).toBe(false);
  }
});

test('preserves the body failure and attaches cleanup failure', async () => {
  const bodyError = new Error('body failed');
  const cleanupError = new Error('cleanup failed');

  await expect(
    withTemporaryDirectory(
      async () => {
        throw bodyError;
      },
      {
        prefix: 'fixture-failure-',
        async removeDirectory() {
          throw cleanupError;
        },
      },
    ),
  ).rejects.toBe(bodyError);
  expect((bodyError as Error & { cleanupError?: unknown }).cleanupError).toBe(
    cleanupError,
  );
});

test('surfaces cleanup failure when the body succeeds', async () => {
  const cleanupError = new Error('cleanup failed');

  await expect(
    withTemporaryDirectory(async () => undefined, {
      prefix: 'fixture-cleanup-',
      async removeDirectory() {
        throw cleanupError;
      },
    }),
  ).rejects.toBe(cleanupError);
});

test('does not call the body when allocation fails during partial setup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fixture-blocked-root-'));
  const blocked = join(root, 'file');
  await writeFile(blocked, 'not a directory');
  let called = false;

  try {
    await expect(
      withTemporaryDirectory(
        async () => {
          called = true;
        },
        { root: blocked, prefix: 'child-' },
      ),
    ).rejects.toThrow();
    expect(called).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('treats an already-missing directory as cleaned', async () => {
  let observed = '';

  await withTemporaryDirectory(async (dir) => {
    observed = dir;
    await rm(dir, { recursive: true });
  });

  expect(await exists(observed)).toBe(false);
});

test('uses a caller-selected temporary root without owning it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fixture-custom-root-'));
  let observed = '';

  try {
    await withTemporaryDirectory(
      async (dir) => {
        observed = dir;
        expect(dir.startsWith(join(root, 'child-'))).toBe(true);
      },
      { root, prefix: 'child-' },
    );
    expect(await exists(observed)).toBe(false);
    expect(await exists(root)).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

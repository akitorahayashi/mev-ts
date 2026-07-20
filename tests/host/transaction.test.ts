import { expect } from 'bun:test';
import { mkdir, readdir, realpath, stat, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { transactionDirectory } from '../../src/host/transaction';
import { sandboxedTest } from '../fixtures/temporary-directory';

// transactionDirectory owns only the staging-directory primitive: it prepares a
// fresh sibling directory on the target's real filesystem for a later same-parent
// atomic swap. The swap and its rollback are owned by the callers that use this
// primitive (atomic-file, directory-replacement, symlink), which are exercised in
// their own integration tests.

const sandbox = sandboxedTest('mev-transaction-');

sandbox(
  'creates a fresh empty sibling directory named after the target',
  async (dir) => {
    const target = join(dir, 'role');

    const staging = await transactionDirectory(target);

    expect((await stat(staging)).isDirectory()).toBe(true);
    expect(await readdir(staging)).toEqual([]);
    expect(dirname(staging)).toBe(await realpath(dir));
    expect(basename(staging).startsWith('.role.')).toBe(true);
  },
);

sandbox('creates missing parent directories for the target', async (dir) => {
  const parent = join(dir, 'nested', 'deep');

  const staging = await transactionDirectory(join(parent, 'role'));

  expect((await stat(staging)).isDirectory()).toBe(true);
  expect(dirname(staging)).toBe(await realpath(parent));
});

sandbox('returns a distinct directory on each call', async (dir) => {
  const target = join(dir, 'role');

  const first = await transactionDirectory(target);
  const second = await transactionDirectory(target);

  expect(first).not.toBe(second);
  expect((await stat(first)).isDirectory()).toBe(true);
  expect((await stat(second)).isDirectory()).toBe(true);
});

sandbox(
  'resolves the parent through symlinks so staging stays on the real parent',
  async (dir) => {
    const realParent = join(dir, 'real');
    await mkdir(realParent);
    const linkedParent = join(dir, 'linked');
    await symlink(realParent, linkedParent);

    const staging = await transactionDirectory(join(linkedParent, 'role'));

    expect(dirname(staging)).toBe(await realpath(realParent));
  },
);

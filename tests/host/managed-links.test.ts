import { expect } from 'bun:test';
import { lstat, mkdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileManagedLinks } from '../../src/host/managed-links';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('managed-links-');

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function scaffold(dir: string): Promise<{
  source: string;
  root: string;
}> {
  const source = join(dir, 'source');
  const root = join(dir, 'root');
  await mkdir(source, { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(source, 'a'), 'a');
  return { source, root };
}

sandboxTest('creates each desired link', async (dir) => {
  const { source, root } = await scaffold(dir);

  const changed = await reconcileManagedLinks(
    root,
    [`${source}/`],
    [{ path: join(root, 'a'), target: join(source, 'a') }],
  );

  expect(changed).toBe(true);
  expect(await readlink(join(root, 'a'))).toBe(join(source, 'a'));
});

sandboxTest('reports unchanged when already reconciled', async (dir) => {
  const { source, root } = await scaffold(dir);
  const desired = [{ path: join(root, 'a'), target: join(source, 'a') }];

  await reconcileManagedLinks(root, [`${source}/`], desired);
  const second = await reconcileManagedLinks(root, [`${source}/`], desired);

  expect(second).toBe(false);
});

sandboxTest(
  'retargets a managed link pointing at the wrong target',
  async (dir) => {
    const { source, root } = await scaffold(dir);
    await writeFile(join(source, 'old'), 'old');
    await symlink(join(source, 'old'), join(root, 'a'));

    const changed = await reconcileManagedLinks(
      root,
      [`${source}/`],
      [{ path: join(root, 'a'), target: join(source, 'a') }],
    );

    expect(changed).toBe(true);
    expect(await readlink(join(root, 'a'))).toBe(join(source, 'a'));
  },
);

sandboxTest(
  'removes a stale managed link but keeps unmanaged and non-symlink entries',
  async (dir) => {
    const { source, root } = await scaffold(dir);
    await writeFile(join(source, 'stale'), 's');
    await symlink(join(source, 'stale'), join(root, 'stale'));
    // An unmanaged symlink whose target is outside the managed prefix.
    const foreign = join(dir, 'foreign');
    await writeFile(foreign, 'f');
    await symlink(foreign, join(root, 'keep'));
    // A real file.
    await writeFile(join(root, 'real'), 'r');

    const changed = await reconcileManagedLinks(
      root,
      [`${source}/`],
      [{ path: join(root, 'a'), target: join(source, 'a') }],
    );

    expect(changed).toBe(true);
    expect(await present(join(root, 'stale'))).toBe(false);
    expect(await readlink(join(root, 'keep'))).toBe(foreign);
    expect(await present(join(root, 'real'))).toBe(true);
    expect(await readlink(join(root, 'a'))).toBe(join(source, 'a'));
  },
);

sandboxTest('keeps stale managed links when a placement fails', async (dir) => {
  const { source, root } = await scaffold(dir);
  await writeFile(join(source, 'stale'), 's');
  await symlink(join(source, 'stale'), join(root, 'stale'));
  // A regular file where the desired link's parent must be, so placing it fails.
  await writeFile(join(root, 'blocked'), 'x');

  await expect(
    reconcileManagedLinks(
      root,
      [`${source}/`],
      [{ path: join(root, 'blocked', 'a'), target: join(source, 'a') }],
    ),
  ).rejects.toBeInstanceOf(Error);

  // The stale link survives because pruning runs only after placement succeeds.
  expect(await readlink(join(root, 'stale'))).toBe(join(source, 'stale'));
});

import { expect } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectAssets } from '../../scripts/asset-registry';
import { sandboxedTest } from '../fixtures/temporary-directory';

const test = sandboxedTest('asset-registry-');

async function seed(root: string): Promise<void> {
  await mkdir(join(root, 'shell/nested'), { recursive: true });
  await writeFile(join(root, 'shell/.zshenv'), 'export A=1\n');
  await writeFile(join(root, 'shell/nested/hook.sh'), '#!/bin/sh\n');
  await chmod(join(root, 'shell/nested/hook.sh'), 0o755);
  await writeFile(join(root, '.DS_Store'), 'junk');
}

test('keys are the path relative to the root, in sorted order', async (root) => {
  await seed(root);

  const entries = await collectAssets(root);

  // .DS_Store is excluded: it is Finder metadata, never a deployable asset.
  expect(entries.map((entry) => entry.key)).toEqual([
    'shell/.zshenv',
    'shell/nested/hook.sh',
  ]);
  expect(entries[0]?.content).toBe('export A=1\n');
});

test('the owner-execute bit is carried into the entry', async (root) => {
  await seed(root);

  const entries = await collectAssets(root);

  // Statusline scripts are invoked directly, so deployment restores this bit.
  expect(
    Object.fromEntries(
      entries.map((entry) => [entry.key, entry.executable] as const),
    ),
  ).toEqual({ 'shell/.zshenv': false, 'shell/nested/hook.sh': true });
});

test('a non-UTF-8 asset is rejected rather than embedded lossily', async (root) => {
  await mkdir(join(root, 'shell'), { recursive: true });
  await writeFile(join(root, 'shell/binary'), Buffer.from([0xff, 0xfe, 0x00]));

  await expect(collectAssets(root)).rejects.toThrow('not valid UTF-8');
});

import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../errors';
import { readDisabled, resolve } from './manifest';

test('resolve enables everything absent from disabled, in catalog order', () => {
  const selection = resolve(['a', 'b', 'c'], ['b']);
  expect(selection.enabled).toEqual(['a', 'c']);
  expect(selection.disabled).toEqual(['b']);
  expect(selection.unknownDisabled).toEqual([]);
});

test('resolve reports disabled names absent from the catalog as skew', () => {
  const selection = resolve(['a'], ['gone']);
  expect(selection.enabled).toEqual(['a']);
  expect(selection.unknownDisabled).toEqual(['gone']);
});

test('readDisabled rejects non-string disabled entries', async () => {
  const dir = join(
    process.cwd(),
    '.tmp',
    `coder-manifest-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    const manifest = join(dir, 'selection.yml');
    await writeFile(manifest, 'disabled:\n  - 42\n');

    await expect(readDisabled(manifest)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

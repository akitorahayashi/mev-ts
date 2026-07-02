import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import { readEnabled } from '../../src/provisioning/zed/manifest';

test('readEnabled rejects non-string enabled entries', async () => {
  const dir = join(
    process.cwd(),
    '.tmp',
    `zed-manifest-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    const manifest = join(dir, 'selection.yml');
    await writeFile(manifest, 'enabled:\n  - 42\n');

    await expect(readEnabled(manifest)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

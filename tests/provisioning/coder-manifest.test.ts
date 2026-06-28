import { expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import { readDisabled } from '../../src/provisioning/coder/manifest';

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

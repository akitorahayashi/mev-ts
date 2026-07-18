import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import {
  appliedPath,
  invalidateApplied,
  readApplied,
  writeApplied,
} from '../../src/provisioning/applied';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('applied-');
const signature = `sha256:${'a'.repeat(64)}`;

sandboxTest(
  'missing state is null and a written signature round-trips',
  async (home) => {
    const path = appliedPath(home, 'git');

    expect(await readApplied(path)).toBeNull();
    await writeApplied(path, signature);
    expect(await readApplied(path)).toBe(signature);
    await invalidateApplied(path);
    await invalidateApplied(path);
    expect(await readApplied(path)).toBeNull();
  },
);

sandboxTest('malformed persisted state is rejected', async (home) => {
  const path = appliedPath(home, 'git');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'not-a-signature\n');

  await expect(readApplied(path)).rejects.toBeInstanceOf(ProvisioningError);
});

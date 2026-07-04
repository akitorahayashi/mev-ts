import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import { readDisabled } from '../../src/provisioning/coder/manifest';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('readDisabled rejects non-string disabled entries', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const manifest = join(dir, 'selection.yml');
      await writeFile(manifest, 'disabled:\n  - 42\n');

      await expect(readDisabled(manifest)).rejects.toBeInstanceOf(
        ProvisioningError,
      );
    },
    { prefix: 'coder-manifest-' },
  );
});

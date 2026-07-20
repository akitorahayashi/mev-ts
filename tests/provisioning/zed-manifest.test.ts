import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import { readEnabled } from '../../src/zed/manifest';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('readEnabled rejects non-string enabled entries', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const manifest = join(dir, 'selection.yml');
      await writeFile(manifest, 'enabled:\n  - 42\n');

      await expect(readEnabled(manifest)).rejects.toBeInstanceOf(
        ProvisioningError,
      );
    },
    { prefix: 'zed-manifest-' },
  );
});

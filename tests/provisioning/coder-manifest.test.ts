import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSelection } from '../../src/coder/manifest';
import { ProvisioningError } from '../../src/errors';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('the coder selection rejects non-string entries in its manifest', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const manifest = join(dir, 'selection.yml');
      await writeFile(manifest, 'disabled:\n  - 42\n');

      await expect(catalogSelection.read(manifest)).rejects.toBeInstanceOf(
        ProvisioningError,
      );
    },
    { prefix: 'coder-manifest-' },
  );
});

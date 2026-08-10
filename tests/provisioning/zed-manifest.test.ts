import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import { overrideSelection } from '../../src/zed/manifest';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('the zed override selection rejects non-string entries in its manifest', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const manifest = join(dir, 'selection.yml');
      await writeFile(manifest, 'enabled:\n  - 42\n');

      await expect(overrideSelection.read(manifest)).rejects.toBeInstanceOf(
        ProvisioningError,
      );
    },
    { prefix: 'zed-manifest-' },
  );
});

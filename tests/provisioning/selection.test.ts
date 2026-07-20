import { expect } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readNameList,
  writeNameList,
} from '../../src/config-selection/selection';
import { ProvisioningError } from '../../src/errors';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('selection-');
const LABEL = 'selection manifest';

sandboxTest('write then read round-trips the name list', async (dir) => {
  const path = join(dir, 'manifest.yml');
  await writeNameList(path, 'disabled', ['alpha', 'beta']);
  expect(await readNameList(path, 'disabled', LABEL)).toEqual([
    'alpha',
    'beta',
  ]);
});

sandboxTest('reading an absent manifest yields an empty list', async (dir) => {
  const path = join(dir, 'missing.yml');
  expect(await readNameList(path, 'disabled', LABEL)).toEqual([]);
});

sandboxTest('writing an empty list removes the manifest file', async (dir) => {
  const path = join(dir, 'manifest.yml');
  await writeNameList(path, 'disabled', ['alpha']);
  await writeNameList(path, 'disabled', []);
  expect(await Bun.file(path).exists()).toBe(false);
  expect(await readNameList(path, 'disabled', LABEL)).toEqual([]);
});

sandboxTest(
  'writing an empty list to an absent path is a no-op',
  async (dir) => {
    const path = join(dir, 'never.yml');
    await writeNameList(path, 'disabled', []);
    expect(await Bun.file(path).exists()).toBe(false);
  },
);

sandboxTest(
  'a non-sequence value for the key is rejected with the label',
  async (dir) => {
    const path = join(dir, 'manifest.yml');
    await writeFile(path, 'disabled: {}\n');
    await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  },
);

sandboxTest('a sequence with a non-string entry is rejected', async (dir) => {
  const path = join(dir, 'manifest.yml');
  await writeFile(path, 'disabled:\n  - 1\n  - two\n');
  await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

sandboxTest('a present manifest missing the key is rejected', async (dir) => {
  const path = join(dir, 'manifest.yml');
  await writeFile(path, 'other:\n  - x\n');
  await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

sandboxTest(
  'a present manifest with unknown fields is rejected',
  async (dir) => {
    const path = join(dir, 'manifest.yml');
    await writeFile(path, 'disabled:\n  - x\nextra: []\n');
    await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  },
);

sandboxTest(
  'a present manifest with duplicate names is rejected',
  async (dir) => {
    const path = join(dir, 'manifest.yml');
    await writeFile(path, 'disabled:\n  - x\n  - x\n');
    await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  },
);

sandboxTest(
  'a present manifest that is not a mapping is rejected',
  async (dir) => {
    const path = join(dir, 'manifest.yml');
    await writeFile(path, '- just\n- a\n- list\n');
    await expect(readNameList(path, 'disabled', LABEL)).rejects.toBeInstanceOf(
      ProvisioningError,
    );
  },
);

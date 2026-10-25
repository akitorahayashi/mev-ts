import { expect } from 'bun:test';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import {
  readDeployedDirents,
  readDeployedText,
} from '../../src/host/deployed-file';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('deployed-file-');

sandboxTest(
  'expected filesystem errors have resource labels, paths, and native causes',
  async (directory) => {
    const file = join(directory, 'not-a-directory');
    await writeFile(file, 'data');
    for (const read of [
      () => readDeployedDirents(file, 'Skill catalog'),
      () => readDeployedText(join(file, 'catalog.yml'), 'Section catalog'),
    ]) {
      try {
        await read();
        throw new Error('Expected resource failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ProvisioningError);
        expect((error as Error).message).toContain('catalog');
        expect((error as Error).message).toContain(file);
        expect((error as Error).cause).toHaveProperty('code', 'ENOTDIR');
      }
    }
  },
);

sandboxTest(
  'absent deployed resources retain deploy-first guidance',
  async (directory) => {
    await expect(
      readDeployedDirents(join(directory, 'missing'), 'Skill catalog'),
    ).rejects.toThrow('Run provisioning to deploy it first');
    await expect(
      readDeployedText(join(directory, 'missing'), 'Section catalog'),
    ).rejects.toThrow('Run provisioning to deploy it first');
  },
);

sandboxTest(
  'unreadable resources are failures rather than absent catalogs',
  async (directory) => {
    const file = join(directory, 'catalog.yml');
    await writeFile(file, 'sections: []');
    await chmod(file, 0);
    try {
      await expect(readDeployedText(file, 'Section catalog')).rejects.toThrow(
        'Failed to read Section catalog',
      );
    } finally {
      await chmod(file, 0o600);
    }
  },
);

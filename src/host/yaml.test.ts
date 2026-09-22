import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { loadYaml } from './yaml';

test('loadYaml maps a syntax error to a labeled ProvisioningError', () => {
  let thrown: unknown;
  try {
    loadYaml('{ invalid yaml', '/path/to/manifest.yml');
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ProvisioningError);
  expect((thrown as Error).message).toContain('/path/to/manifest.yml');
});

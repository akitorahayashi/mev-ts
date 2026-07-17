import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { dumpYaml, loadYaml } from './yaml';

test('loadYaml parses valid YAML into a value', () => {
  expect(loadYaml('a: 1\nb: two\n', 'src')).toEqual({ a: 1, b: 'two' });
});

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

test('dumpYaml output round-trips through loadYaml', () => {
  const value = { list: ['a', 'b'] };
  expect(loadYaml(dumpYaml(value), 'src')).toEqual(value);
});

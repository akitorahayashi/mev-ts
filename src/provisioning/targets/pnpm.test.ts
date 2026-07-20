import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../errors';
import { globalPackageArgs } from './pnpm';

test('globalPackageArgs merges dependency maps into pnpm package arguments', () => {
  expect(
    globalPackageArgs(
      JSON.stringify({
        dependencies: { '@toon-format/cli': 'latest' },
        globalPackages: { typescript: 'latest' },
      }),
    ),
  ).toEqual(['@toon-format/cli@latest', 'typescript@latest']);
});

test('globalPackageArgs rejects invalid JSON', () => {
  expect(() => globalPackageArgs('not json')).toThrow(ProvisioningError);
});

test('globalPackageArgs rejects non-string versions', () => {
  expect(() =>
    globalPackageArgs(JSON.stringify({ dependencies: { typescript: 5 } })),
  ).toThrow(ProvisioningError);
});

test('globalPackageArgs rejects empty manifests', () => {
  expect(() => globalPackageArgs(JSON.stringify({}))).toThrow(
    ProvisioningError,
  );
});

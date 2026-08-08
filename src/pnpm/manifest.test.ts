import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseManifest } from './manifest';

test('parseManifest orders removals ahead of packages', () => {
  const entries = parseManifest(
    'packages:\n  "@toon-format/cli": latest\n  typescript: 5.6.2\nuninstall:\n  - "@github/copilot"\n',
    'global-packages.yml',
  );
  expect(entries).toEqual([
    { action: 'uninstall', name: '@github/copilot' },
    {
      action: 'install',
      package: { name: '@toon-format/cli', version: 'latest' },
    },
    { action: 'install', package: { name: 'typescript', version: '5.6.2' } },
  ]);
});

test('parseManifest treats an omitted uninstall list as nothing to remove', () => {
  const entries = parseManifest(
    'packages:\n  typescript: latest\n',
    'global-packages.yml',
  );
  expect(entries.filter((entry) => entry.action === 'uninstall')).toEqual([]);
});

test('parseManifest accepts an empty packages mapping', () => {
  expect(
    parseManifest('packages: {}\nuninstall:\n  - typescript\n', 'g.yml'),
  ).toEqual([{ action: 'uninstall', name: 'typescript' }]);
});

test('parseManifest accepts a prerelease version pin', () => {
  expect(
    parseManifest('packages:\n  typescript: 5.7.0-beta\n', 'g.yml'),
  ).toEqual([
    {
      action: 'install',
      package: { name: 'typescript', version: '5.7.0-beta' },
    },
  ]);
});

for (const range of ['^5.6.0', '~5.6', '>=5', '5.x', '*', '=5.6.2']) {
  test(`parseManifest rejects the range version ${JSON.stringify(range)}`, () => {
    expect(() =>
      parseManifest(`packages:\n  typescript: "${range}"\n`, 'g.yml'),
    ).toThrow(/'latest' or an exact version pin/);
  });
}

test('parseManifest rejects a name declared in both packages and uninstall', () => {
  expect(() =>
    parseManifest(
      'packages:\n  TypeScript: latest\nuninstall:\n  - typescript\n',
      'g.yml',
    ),
  ).toThrow(/duplicate/);
});

test('parseManifest rejects dash-leading names', () => {
  expect(() =>
    parseManifest('packages:\n  "--flag": latest\n', 'g.yml'),
  ).toThrow(/invalid package name/);
});

test('parseManifest rejects non-string versions', () => {
  expect(() => parseManifest('packages:\n  typescript: 5\n', 'g.yml')).toThrow(
    ProvisioningError,
  );
});

test('parseManifest rejects unknown root keys', () => {
  expect(() =>
    parseManifest('packages: {}\ndependencies: {}\n', 'g.yml'),
  ).toThrow(ProvisioningError);
});

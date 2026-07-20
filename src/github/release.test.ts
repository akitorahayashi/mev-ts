import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseReleaseBinaries } from './release';

const CONFIG = 'rust-cli/binaries.yml';

function entry(fields: string): string {
  return `binaries:\n  - ${fields}\n`;
}

test('parseReleaseBinaries accepts a well-formed entry', () => {
  const binaries = parseReleaseBinaries(
    entry('name: kpv\n    repo: akitorahayashi/kpv\n    tag: v0.6.0'),
    CONFIG,
  );
  expect(binaries).toEqual([
    {
      name: 'kpv',
      repo: 'akitorahayashi/kpv',
      tag: 'v0.6.0',
      private: undefined,
    },
  ]);
});

test('parseReleaseBinaries rejects a tag beginning with a dash', () => {
  expect(() =>
    parseReleaseBinaries(
      entry('name: kpv\n    repo: akitorahayashi/kpv\n    tag: -rf'),
      CONFIG,
    ),
  ).toThrow(ProvisioningError);
});

test('parseReleaseBinaries rejects an asset name with a glob metacharacter', () => {
  expect(() =>
    parseReleaseBinaries(
      entry('name: na*me\n    repo: akitorahayashi/kpv\n    tag: v1'),
      CONFIG,
    ),
  ).toThrow(ProvisioningError);
});

test('parseReleaseBinaries rejects a repo that is not owner/name', () => {
  expect(() =>
    parseReleaseBinaries(
      entry('name: kpv\n    repo: notaslug\n    tag: v1'),
      CONFIG,
    ),
  ).toThrow(ProvisioningError);
});

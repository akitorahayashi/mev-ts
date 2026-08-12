import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import {
  parseReleaseBinaries,
  releaseTagFromRedirect,
  tagVersion,
} from './release';

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
      repo: { owner: 'akitorahayashi', name: 'kpv' },
      tag: 'v0.6.0',
    },
  ]);
});

test('parseReleaseBinaries accepts the latest-assumed tag', () => {
  const binaries = parseReleaseBinaries(
    entry('name: kpv\n    repo: akitorahayashi/kpv\n    tag: latest'),
    CONFIG,
  );
  expect(binaries[0]?.tag).toBe('latest');
});

test('parseReleaseBinaries rejects an unknown entry field', () => {
  expect(() =>
    parseReleaseBinaries(
      entry(
        'name: kpv\n    repo: akitorahayashi/kpv\n    tag: v0.6.0\n    extra: true',
      ),
      CONFIG,
    ),
  ).toThrow(ProvisioningError);
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

const REPO = { owner: 'akitorahayashi', name: 'kpv' } as const;

test('releaseTagFromRedirect reads the tag off the release page redirect', () => {
  expect(
    releaseTagFromRedirect(
      'https://github.com/akitorahayashi/kpv/releases/tag/v0.7.0',
      REPO,
      'Latest release of akitorahayashi/kpv',
    ),
  ).toBe('v0.7.0');
});

test('releaseTagFromRedirect rejects a redirect outside this repository', () => {
  expect(() =>
    releaseTagFromRedirect(
      'https://github.com/someone-else/kpv/releases/tag/v0.7.0',
      REPO,
      'label',
    ),
  ).toThrow(ProvisioningError);
});

test('releaseTagFromRedirect rejects a redirect that is not a tag page', () => {
  expect(() =>
    releaseTagFromRedirect(
      'https://github.com/login?return_to=%2Fakitorahayashi%2Fkpv',
      REPO,
      'label',
    ),
  ).toThrow(ProvisioningError);
});

test('releaseTagFromRedirect rejects a tag outside the safe character set', () => {
  expect(() =>
    releaseTagFromRedirect(
      'https://github.com/akitorahayashi/kpv/releases/tag/v0.7.0%2Fx',
      REPO,
      'label',
    ),
  ).toThrow(ProvisioningError);
});

test('tagVersion strips a single leading v and leaves a bare version alone', () => {
  expect(tagVersion('v5.0.0')).toBe('5.0.0');
  expect(tagVersion('5.0.0')).toBe('5.0.0');
  expect(tagVersion('vv1.0.0')).toBe('v1.0.0');
});

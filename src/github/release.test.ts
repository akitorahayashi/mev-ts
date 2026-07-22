import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import {
  parseReleaseBinaries,
  parseReleaseLock,
  releaseLockKey,
  resolveReleaseDigest,
} from './release';

const CONFIG = 'rust-cli/binaries.yml';
const LOCK = 'rust-cli/binaries.lock.yml';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function entry(fields: string): string {
  return `binaries:\n  - ${fields}\n`;
}

function lockEntry(assets: string): string {
  return `binaries:\n  - name: kpv\n    repo: akitorahayashi/kpv\n    tag: v0.6.0\n    assets:\n${assets}`;
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

test('releaseLockKey derives the .lock.yml sibling of a manifest key', () => {
  expect(releaseLockKey('rust-cli/binaries.yml')).toBe(
    'rust-cli/binaries.lock.yml',
  );
  expect(releaseLockKey('rust-cli/binaries.yaml')).toBe(
    'rust-cli/binaries.lock.yml',
  );
});

test('parseReleaseLock accepts a well-formed entry', () => {
  const lock = parseReleaseLock(
    lockEntry(
      `      darwin-aarch64:\n        sha256: ${SHA_A}\n      darwin-x86_64:\n        sha256: ${SHA_B}\n`,
    ),
    LOCK,
  );
  expect(lock.binaries).toEqual([
    {
      name: 'kpv',
      repo: 'akitorahayashi/kpv',
      tag: 'v0.6.0',
      assets: {
        'darwin-aarch64': { asset: 'darwin-aarch64', sha256: SHA_A },
        'darwin-x86_64': { asset: 'darwin-x86_64', sha256: SHA_B },
      },
    },
  ]);
});

test('parseReleaseLock rejects a malformed sha256', () => {
  expect(() =>
    parseReleaseLock(
      lockEntry('      darwin-aarch64:\n        sha256: not-a-digest\n'),
      LOCK,
    ),
  ).toThrow(ProvisioningError);
});

test('parseReleaseLock rejects an unsupported asset key', () => {
  expect(() =>
    parseReleaseLock(
      lockEntry(`      linux-x86_64:\n        sha256: ${SHA_A}\n`),
      LOCK,
    ),
  ).toThrow(ProvisioningError);
});

test('parseReleaseLock rejects an unknown entry field', () => {
  expect(() =>
    parseReleaseLock(
      `${lockEntry(`      darwin-aarch64:\n        sha256: ${SHA_A}\n`)}    extra: true\n`,
      LOCK,
    ),
  ).toThrow(ProvisioningError);
});

const LOCKED = parseReleaseLock(
  lockEntry(`      darwin-aarch64:\n        sha256: ${SHA_A}\n`),
  LOCK,
);

test('resolveReleaseDigest returns the digest for a locked binary', () => {
  const digest = resolveReleaseDigest(
    { name: 'kpv', repo: 'akitorahayashi/kpv', tag: 'v0.6.0' },
    'aarch64',
    LOCKED,
  );
  expect(digest).toEqual({ asset: 'darwin-aarch64', sha256: SHA_A });
});

test('resolveReleaseDigest rejects a tag absent from the lock', () => {
  expect(() =>
    resolveReleaseDigest(
      { name: 'kpv', repo: 'akitorahayashi/kpv', tag: 'v0.7.0' },
      'aarch64',
      LOCKED,
    ),
  ).toThrow("Run 'bun run lock'");
});

test('resolveReleaseDigest rejects an architecture absent from the lock', () => {
  expect(() =>
    resolveReleaseDigest(
      { name: 'kpv', repo: 'akitorahayashi/kpv', tag: 'v0.6.0' },
      'x86_64',
      LOCKED,
    ),
  ).toThrow("Run 'bun run lock'");
});

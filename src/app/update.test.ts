import { expect, test } from 'bun:test';
import { UpdateError } from '../errors';
import {
  compareReleaseVersions,
  executablePathForBuild,
  mevReleaseAsset,
  mevVersionFromReleaseTag,
} from './update';

test('compares installed and release semantic versions', () => {
  expect(compareReleaseVersions('0.1.0', '0.2.0')).toBe('newer');
  expect(compareReleaseVersions('0.2.0', '0.2.0')).toBe('same');
  expect(compareReleaseVersions('0.3.0', '0.2.0')).toBe('ahead');
});

test('rejects a non-semantic installed or release version', () => {
  expect(() => compareReleaseVersions('dev', '0.2.0')).toThrow(UpdateError);
  expect(() => compareReleaseVersions('0.2.0', 'latest')).toThrow(UpdateError);
  expect(() => compareReleaseVersions('1.2', '0.2.0')).toThrow(UpdateError);
  expect(() => compareReleaseVersions('0.2.0', '01.2.3')).toThrow(UpdateError);
});

test('requires a v-prefixed canonical release tag', () => {
  expect(mevVersionFromReleaseTag('v1.2.3-rc.1')).toBe('1.2.3-rc.1');
  expect(() => mevVersionFromReleaseTag('1.2.3')).toThrow(
    "must start with 'v'",
  );
  expect(() => mevVersionFromReleaseTag('v1.2')).toThrow(UpdateError);
});

test('maps release architectures to the published mev asset vocabulary', () => {
  expect(mevReleaseAsset('aarch64')).toBe('mev-darwin-arm64');
  expect(mevReleaseAsset('x86_64', '.sha256')).toBe('mev-darwin-x64.sha256');
});

test('selects the installed command path from the build kind', () => {
  expect(executablePathForBuild('standalone', '/bin/mev', '/src/main.ts')).toBe(
    '/bin/mev',
  );
  expect(executablePathForBuild('bundle', '/bin/bun', '/bin/mev')).toBe(
    '/bin/mev',
  );
  expect(() =>
    executablePathForBuild(null, '/bin/bun', '/src/main.ts'),
  ).toThrow("Run 'bun run up' first");
});

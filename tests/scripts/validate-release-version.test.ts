import { expect, test } from 'bun:test';
import {
  isSemanticVersion,
  packageVersion,
  validateReleaseTag,
} from '../../scripts/validate-release-version';

test('validates the matching package release tag', () => {
  expect(validateReleaseTag('v1.2.3', '{"version":"1.2.3"}')).toBe('v1.2.3');
});

test('rejects a release tag that does not match package version', () => {
  expect(() => validateReleaseTag('v1.2.4', '{"version":"1.2.3"}')).toThrow(
    'does not match package version v1.2.3',
  );
});

test('rejects package JSON without a version string', () => {
  expect(() => packageVersion('{"version":42}')).toThrow(
    'non-empty string version',
  );
});

test('accepts canonical semantic versions', () => {
  expect(isSemanticVersion('0.2.0')).toBe(true);
  expect(isSemanticVersion('1.2.3-rc.1+build.5')).toBe(true);
});

test('rejects non-canonical semantic versions', () => {
  expect(isSemanticVersion('v0.2.0')).toBe(false);
  expect(isSemanticVersion('01.2.3')).toBe(false);
  expect(isSemanticVersion('1.2')).toBe(false);
  expect(isSemanticVersion('1.2.3-01')).toBe(false);
  expect(() => packageVersion('{"version":"latest"}')).toThrow(
    'canonical semantic version',
  );
});

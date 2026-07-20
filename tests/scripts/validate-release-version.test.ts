import { expect, test } from 'bun:test';
import {
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

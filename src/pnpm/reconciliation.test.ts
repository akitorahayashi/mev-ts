import { expect, test } from 'bun:test';
import { installSpec, needsInstall, shouldUpgrade } from './reconciliation';

const pinned = { name: 'typescript', version: '5.6.2' };
const latest = { name: 'typescript', version: 'latest' };

test('installSpec joins name and version', () => {
  expect(installSpec(pinned)).toBe('typescript@5.6.2');
  expect(installSpec(latest)).toBe('typescript@latest');
});

test('needsInstall installs missing packages', () => {
  expect(needsInstall(pinned, undefined)).toBeTrue();
  expect(needsInstall(latest, undefined)).toBeTrue();
});

test('needsInstall re-adds only on a pin mismatch', () => {
  expect(needsInstall(pinned, { version: '5.5.0' })).toBeTrue();
  expect(needsInstall(pinned, { version: '5.6.2' })).toBeFalse();
  expect(needsInstall(latest, { version: '5.5.0' })).toBeFalse();
});

test('shouldUpgrade re-resolves only installed latest-assumed packages in update mode', () => {
  expect(shouldUpgrade(latest, { version: '5.5.0' }, true)).toBeTrue();
  expect(shouldUpgrade(latest, { version: '5.5.0' }, false)).toBeFalse();
  expect(shouldUpgrade(latest, undefined, true)).toBeFalse();
  expect(shouldUpgrade(pinned, { version: '5.6.2' }, true)).toBeFalse();
});

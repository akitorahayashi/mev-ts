import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import { parseDefaults } from './manifest';

const ENTRY = [
  '- domain: com.apple.dock',
  '  key: autohide',
  '  type: bool',
  '  value: true',
].join('\n');

test('an entry parses into its domain, key, type, and value', () => {
  expect(parseDefaults(ENTRY, 'cfg.yml')).toEqual([
    { domain: 'com.apple.dock', key: 'autohide', type: 'bool', value: true },
  ]);
});

test('an unknown field is rejected naming the file and the entry position', () => {
  const raw = `${ENTRY}\n  extra: 1\n`;

  expect(() => parseDefaults(raw, 'cfg.yml')).toThrow(ProvisioningError);
  // One label, not two: the caller passes the entry label straight to the
  // shared key check rather than re-wrapping what it throws.
  expect(() => parseDefaults(raw, 'cfg.yml')).toThrow(
    "Invalid defaults config cfg.yml entry 1 contains unknown field 'extra'. Expected only: domain, key, type, value.",
  );
});

test('a type mismatch names the entry position once', () => {
  const raw = ENTRY.replace('value: true', 'value: 3');

  expect(() => parseDefaults(raw, 'cfg.yml')).toThrow(
    "Invalid defaults config cfg.yml entry 1: 'value' must be a boolean.",
  );
});

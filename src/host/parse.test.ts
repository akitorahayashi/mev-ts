import { expect, test } from 'bun:test';
import { ProvisioningError } from '../errors';
import {
  isRecord,
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from './parse';

test('isRecord accepts plain objects and rejects arrays, null, and primitives', () => {
  expect(isRecord({})).toBe(true);
  expect(isRecord({ a: 1 })).toBe(true);

  expect(isRecord([])).toBe(false);
  expect(isRecord([1, 2])).toBe(false);
  expect(isRecord(null)).toBe(false);
  expect(isRecord(undefined)).toBe(false);
  expect(isRecord('text')).toBe(false);
  expect(isRecord(42)).toBe(false);
  expect(isRecord(true)).toBe(false);
});

test('requireRecord returns the same mapping and rejects non-mappings', () => {
  const value = { key: 'value' };
  expect(requireRecord(value, 'config')).toBe(value);

  expect(() => requireRecord([], 'config')).toThrow(ProvisioningError);
  expect(() => requireRecord(null, 'config')).toThrow(
    'config must be a mapping.',
  );
  expect(() => requireRecord('text', 'config')).toThrow(ProvisioningError);
});

test('requireStringArray returns the same array and rejects non-string sequences', () => {
  const value = ['a', 'b'];
  expect(requireStringArray(value, 'items')).toBe(value);
  expect(requireStringArray([], 'items')).toEqual([]);

  expect(() => requireStringArray('a', 'items')).toThrow(ProvisioningError);
  expect(() => requireStringArray('a', 'items')).toThrow(
    'items must be a sequence.',
  );
  expect(() => requireStringArray(['a', 1], 'items')).toThrow(
    'items must be a sequence of strings.',
  );
});

test('requireExactKeys allows a subset of the allowed keys and names the first unknown field', () => {
  expect(() =>
    requireExactKeys({ a: 1, b: 2 }, ['a', 'b', 'c'], 'block'),
  ).not.toThrow();
  expect(() => requireExactKeys({}, ['a'], 'block')).not.toThrow();

  let caught: unknown;
  try {
    requireExactKeys({ a: 1, zzz: 2 }, ['a', 'b'], 'block');
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProvisioningError);
  expect((caught as Error).message).toContain("'zzz'");
  expect((caught as Error).message).toContain('a, b');
});

test('requireUniqueBy passes distinct keys and rejects the first duplicated key', () => {
  expect(() =>
    requireUniqueBy([{ id: 'a' }, { id: 'b' }], (v) => v.id, 'entries'),
  ).not.toThrow();

  expect(() =>
    requireUniqueBy([{ id: 'a' }, { id: 'a' }], (v) => v.id, 'entries'),
  ).toThrow(ProvisioningError);
  expect(() =>
    requireUniqueBy(
      [{ id: 'x' }, { id: 'y' }, { id: 'x' }],
      (v) => v.id,
      'entries',
    ),
  ).toThrow("entries contains duplicate 'x'.");
});

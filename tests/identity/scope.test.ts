import { expect, test } from 'bun:test';
import {
  aliasesOf,
  allScopes,
  resolveScope,
} from '../../src/mev/identity/scope';

test('allScopes lists personal and work in declaration order', () => {
  expect(allScopes()).toEqual(['personal', 'work']);
});

test('resolveScope accepts canonical names', () => {
  expect(resolveScope('personal')).toBe('personal');
  expect(resolveScope('work')).toBe('work');
});

test('resolveScope accepts aliases case-insensitively', () => {
  expect(resolveScope('p')).toBe('personal');
  expect(resolveScope('W')).toBe('work');
  expect(resolveScope('Personal')).toBe('personal');
});

test('resolveScope returns null for unknown input', () => {
  expect(resolveScope('unknown')).toBeNull();
});

test('aliasesOf returns the input aliases for a scope', () => {
  expect(aliasesOf('personal')).toEqual(['p']);
  expect(aliasesOf('work')).toEqual(['w']);
});

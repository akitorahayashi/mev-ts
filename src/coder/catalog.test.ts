import { expect, test } from 'bun:test';
import { reconcileSections } from './catalog';

test('reconcileSections preserves catalog order and rejects skew', () => {
  expect(reconcileSections(['a', 'b'], ['b', 'a'])).toEqual(['a', 'b']);
  expect(() => reconcileSections(['a', 'missing'], ['a'])).toThrow();
  expect(() => reconcileSections(['a'], ['a', 'stray'])).toThrow();
  expect(() => reconcileSections(['a', 'a'], ['a'])).toThrow();
});

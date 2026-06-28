import { expect, test } from 'bun:test';
import { resolve } from './manifest';

test('resolve enables everything absent from disabled, in catalog order', () => {
  const selection = resolve(['a', 'b', 'c'], ['b']);
  expect(selection.enabled).toEqual(['a', 'c']);
  expect(selection.disabled).toEqual(['b']);
  expect(selection.unknownDisabled).toEqual([]);
});

test('resolve reports disabled names absent from the catalog as skew', () => {
  const selection = resolve(['a'], ['gone']);
  expect(selection.enabled).toEqual(['a']);
  expect(selection.unknownDisabled).toEqual(['gone']);
});

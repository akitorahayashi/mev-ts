import { expect, test } from 'bun:test';
import { resolve } from './manifest';

test('resolve enables only names present in the enabled list, in catalog order', () => {
  const selection = resolve(['a', 'b', 'c'], ['b']);
  expect(selection.enabled).toEqual(['b']);
  expect(selection.disabled).toEqual(['a', 'c']);
  expect(selection.unknownEnabled).toEqual([]);
});

test('resolve reports enabled names absent from the catalog as skew', () => {
  const selection = resolve(['a'], ['gone']);
  expect(selection.enabled).toEqual([]);
  expect(selection.unknownEnabled).toEqual(['gone']);
});

test('resolve enables nothing when the enabled list is empty', () => {
  const selection = resolve(['a', 'b'], []);
  expect(selection.enabled).toEqual([]);
  expect(selection.disabled).toEqual(['a', 'b']);
});

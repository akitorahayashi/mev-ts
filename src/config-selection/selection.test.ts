import { expect, test } from 'bun:test';
import { resolveSelection } from './selection';

test('opt-out enables everything absent from the disabled list, in catalog order', () => {
  const selection = resolveSelection(['a', 'b', 'c'], ['b'], 'opt-out');
  expect(selection.enabled).toEqual(['a', 'c']);
  expect(selection.disabled).toEqual(['b']);
  expect(selection.unknown).toEqual([]);
});

test('opt-out reports disabled names absent from the catalog as skew', () => {
  const selection = resolveSelection(['a'], ['gone'], 'opt-out');
  expect(selection.enabled).toEqual(['a']);
  expect(selection.unknown).toEqual(['gone']);
});

test('opt-in enables only names present in the enabled list, in catalog order', () => {
  const selection = resolveSelection(['a', 'b', 'c'], ['b'], 'opt-in');
  expect(selection.enabled).toEqual(['b']);
  expect(selection.disabled).toEqual(['a', 'c']);
  expect(selection.unknown).toEqual([]);
});

test('opt-in reports enabled names absent from the catalog as skew', () => {
  const selection = resolveSelection(['a'], ['gone'], 'opt-in');
  expect(selection.enabled).toEqual([]);
  expect(selection.unknown).toEqual(['gone']);
});

test('opt-in enables nothing when the enabled list is empty', () => {
  const selection = resolveSelection(['a', 'b'], [], 'opt-in');
  expect(selection.enabled).toEqual([]);
  expect(selection.disabled).toEqual(['a', 'b']);
});

import { expect, test } from 'bun:test';
import { mergeDeclared, tomlValueEqual } from './codex-config';

test('declared scalars and arrays replace host values', () => {
  const merged = mergeDeclared(
    { model: 'old', skills: { config: [{ path: 'a' }, { path: 'user' }] } },
    { model: 'new', skills: { config: [{ path: 'a' }] } },
  );
  expect(merged['model']).toBe('new');
  expect(merged['skills']).toEqual({ config: [{ path: 'a' }] });
});

test('declared tables merge per key and preserve host-only keys', () => {
  const merged = mergeDeclared(
    { tui: { theme: 'old', animations: true }, plugins: { x: true } },
    { tui: { theme: 'new' } },
  );
  expect(merged['tui']).toEqual({ theme: 'new', animations: true });
  expect(merged['plugins']).toEqual({ x: true });
});

test('a declared table replaces a host scalar of the same name', () => {
  const merged = mergeDeclared({ otel: 'off' }, { otel: { exporter: 'none' } });
  expect(merged['otel']).toEqual({ exporter: 'none' });
});

test('tomlValueEqual ignores key order but not array order', () => {
  expect(
    tomlValueEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }),
  ).toBe(true);
  expect(tomlValueEqual([1, 2], [2, 1])).toBe(false);
  expect(tomlValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
});

test('tomlValueEqual compares dates by instant', () => {
  const at = '2026-08-08T04:50:41Z';
  expect(tomlValueEqual(new Date(at), new Date(at))).toBe(true);
  expect(tomlValueEqual(new Date(at), at)).toBe(false);
});

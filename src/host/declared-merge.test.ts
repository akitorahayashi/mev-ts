import { expect, test } from 'bun:test';
import {
  declaredAssignments,
  mergeDeclared,
  valueEqual,
} from './declared-merge';

const LABEL = 'test config';

test('declared scalars and arrays replace host values', () => {
  const merged = mergeDeclared(
    { model: 'old', skills: { config: [{ path: 'a' }, { path: 'user' }] } },
    { model: 'new', skills: { config: [{ path: 'a' }] } },
    LABEL,
  );
  expect(merged['model']).toBe('new');
  expect(merged['skills']).toEqual({ config: [{ path: 'a' }] });
});

test('declared mappings merge per key and preserve host-only keys', () => {
  const merged = mergeDeclared(
    { tui: { theme: 'old', animations: true }, plugins: { x: true } },
    { tui: { theme: 'new' } },
    LABEL,
  );
  expect(merged['tui']).toEqual({ theme: 'new', animations: true });
  expect(merged['plugins']).toEqual({ x: true });
});

test('a declared mapping replaces a host scalar of the same name', () => {
  const merged = mergeDeclared(
    { otel: 'off' },
    { otel: { exporter: 'none' } },
    LABEL,
  );
  expect(merged['otel']).toEqual({ exporter: 'none' });
});

test('host-only enablement state survives a merge that declares neighbours', () => {
  const merged = mergeDeclared(
    { enabledPlugins: { 'simplify@simplify': true }, theme: 'dark' },
    { theme: 'auto' },
    LABEL,
  );
  expect(merged).toEqual({
    enabledPlugins: { 'simplify@simplify': true },
    theme: 'auto',
  });
});

test('a declared key that reassigns the prototype chain is rejected', () => {
  expect(() =>
    mergeDeclared({}, JSON.parse('{"__proto__": {"polluted": true}}'), LABEL),
  ).toThrow(/disallowed key '__proto__'/);
});

test('nested unsafe keys are rejected regardless of the host shape', () => {
  const declared = JSON.parse('{"outer": {"__proto__": {"polluted": true}}}');
  // Absent, scalar, and mapping host parents all take the same rejection: the
  // declared document is malformed everywhere, not only where the host happens
  // to hold a mapping the merge would recurse into.
  for (const host of [{}, { outer: 'scalar' }, { outer: { kept: 1 } }]) {
    expect(() => mergeDeclared(host, declared, LABEL)).toThrow(
      /disallowed key '__proto__'/,
    );
  }
  expect(() =>
    mergeDeclared(
      {},
      JSON.parse('{"list": [{"constructor": {}}]}') as Record<string, unknown>,
      LABEL,
    ),
  ).toThrow(/disallowed key 'constructor'/);
});

test('valueEqual ignores key order but not array order', () => {
  expect(
    valueEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }),
  ).toBe(true);
  expect(valueEqual([1, 2], [2, 1])).toBe(false);
  expect(valueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
});

test('valueEqual compares dates by instant', () => {
  const at = '2026-08-08T04:50:41Z';
  expect(valueEqual(new Date(at), new Date(at))).toBe(true);
  expect(valueEqual(new Date(at), at)).toBe(false);
});

test('declaredAssignments names exactly the paths the merge would write', () => {
  const paths = declaredAssignments(
    { tui: { theme: 'old', animations: true }, model: 'gpt-test' },
    { tui: { theme: 'new' }, model: 'gpt-test', otel: { exporter: 'none' } },
    LABEL,
  );
  // The equal scalar is skipped, the nested key merges into the host mapping,
  // and the mapping without a host counterpart is assigned wholesale.
  expect(paths).toEqual([
    [['tui', 'theme'], 'new'],
    [['otel'], { exporter: 'none' }],
  ]);
});

test('declaredAssignments rejects unsafe keys like the merge does', () => {
  expect(() =>
    declaredAssignments(
      {},
      JSON.parse('{"outer": {"__proto__": {}}}') as Record<string, unknown>,
      LABEL,
    ),
  ).toThrow(/disallowed key '__proto__'/);
});

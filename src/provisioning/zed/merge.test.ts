import { expect, test } from 'bun:test';
import { combineOverrides, deepMerge } from './merge';

test('deepMerge lets the overlay win on leaves while preserving untouched base keys', () => {
  const merged = deepMerge(
    { format_on_save: 'on', tab_size: 2, agent: { button: true } },
    { format_on_save: 'off', agent: { dock: 'right' } },
  );
  expect(merged).toEqual({
    format_on_save: 'off',
    tab_size: 2,
    agent: { button: true, dock: 'right' },
  });
});

test('combineOverrides merges disjoint overrides', () => {
  const combined = combineOverrides([
    { name: 'formatting', settings: { format_on_save: 'off' } },
    {
      name: 'commit-model',
      settings: { agent: { commit_message_model: { provider: 'anthropic' } } },
    },
  ]);
  expect(combined).toEqual({
    format_on_save: 'off',
    agent: { commit_message_model: { provider: 'anthropic' } },
  });
});

test('combineOverrides throws when two overrides set the same leaf key', () => {
  expect(() =>
    combineOverrides([
      { name: 'formatting', settings: { format_on_save: 'off' } },
      { name: 'strict', settings: { format_on_save: 'on' } },
    ]),
  ).toThrow(/formatting.*strict.*format_on_save/);
});

test('combineOverrides throws on a nested key collision', () => {
  expect(() =>
    combineOverrides([
      {
        name: 'a',
        settings: { agent: { commit_message_model: { model: 'x' } } },
      },
      {
        name: 'b',
        settings: { agent: { commit_message_model: { model: 'y' } } },
      },
    ]),
  ).toThrow(/agent\.commit_message_model\.model/);
});

test('combineOverrides allows the same override to appear only once without colliding with itself', () => {
  const combined = combineOverrides([
    { name: 'formatting', settings: { format_on_save: 'off', tab_size: 4 } },
  ]);
  expect(combined).toEqual({ format_on_save: 'off', tab_size: 4 });
});

test('combineOverrides throws when a later override replaces an ancestor of an earlier nested key', () => {
  expect(() =>
    combineOverrides([
      {
        name: 'a',
        settings: { agent: { commit_message_model: { model: 'x' } } },
      },
      { name: 'b', settings: { agent: 'some-string' } },
    ]),
  ).toThrow(/a.*b.*agent/);
});

test('combineOverrides throws when an earlier override sets a primitive ancestor and a later one nests under it', () => {
  expect(() =>
    combineOverrides([
      { name: 'a', settings: { agent: 'some-string' } },
      {
        name: 'b',
        settings: { agent: { commit_message_model: { model: 'x' } } },
      },
    ]),
  ).toThrow(/a.*b.*agent/);
});

test('combineOverrides rejects a __proto__ key rather than merging it', () => {
  expect(() =>
    combineOverrides([
      {
        name: 'malformed',
        settings: JSON.parse('{"__proto__": {"polluted": true}}'),
      },
    ]),
  ).toThrow(/malformed.*disallowed key '__proto__'/);
});

test('deepMerge rejects a __proto__ key rather than merging it', () => {
  expect(() =>
    deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}}')),
  ).toThrow(/disallowed key '__proto__'/);
});

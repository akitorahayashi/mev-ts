import { expect, test } from 'bun:test';
import { withAliasHint } from './alias-hint';

test('appends a single alias hint from the non-canonical path', () => {
  expect(withAliasHint('Do a thing.', [['make'], ['mk']])).toBe(
    'Do a thing. [aliases: mk]',
  );
});

test('joins multi-token alias paths with spaces and multiple aliases with commas', () => {
  expect(
    withAliasHint('Show it.', [
      ['user', 'show'],
      ['us', 'show'],
      ['u', 'sh'],
    ]),
  ).toBe('Show it. [aliases: us show, u sh]');
});

test('leaves the description unchanged when there is only a canonical path', () => {
  expect(withAliasHint('Only one.', [['solo']])).toBe('Only one.');
});

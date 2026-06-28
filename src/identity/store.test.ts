import { expect, test } from 'bun:test';
import { identityFilePath, makeIdentity } from './store';

test('makeIdentity trims and validates non-empty fields', () => {
  expect(makeIdentity(' Jane ', ' jane@example.com ')).toEqual({
    name: 'Jane',
    email: 'jane@example.com',
  });
  expect(makeIdentity('', 'jane@example.com')).toBeNull();
  expect(makeIdentity('Jane', '  ')).toBeNull();
});

test('identityFilePath resolves under ~/.config/mev', () => {
  expect(identityFilePath('/Users/test')).toBe(
    '/Users/test/.config/mev/identity.json',
  );
});

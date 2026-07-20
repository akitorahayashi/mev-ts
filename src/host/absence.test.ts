import { expect, test } from 'bun:test';
import { isNotFound } from './absence';

test('isNotFound classifies only ENOENT-coded errors as missing', () => {
  expect(isNotFound({ code: 'ENOENT' })).toBe(true);
  expect(
    isNotFound(Object.assign(new Error('missing'), { code: 'ENOENT' })),
  ).toBe(true);

  expect(isNotFound({ code: 'EACCES' })).toBe(false);
  expect(isNotFound({ code: 'enoent' })).toBe(false);
  expect(isNotFound(new Error('no code'))).toBe(false);
  expect(isNotFound(null)).toBe(false);
  expect(isNotFound(undefined)).toBe(false);
  expect(isNotFound('ENOENT')).toBe(false);
});

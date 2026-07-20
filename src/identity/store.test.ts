import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTemporaryDirectory } from '../../tests/fixtures/temporary-directory';
import { AppError } from '../errors';
import { identityFilePath, makeIdentity, readState } from './store';

test('makeIdentity trims and validates non-empty fields', () => {
  expect(makeIdentity(' Jane ', ' jane@example.com ')).toEqual({
    name: 'Jane',
    email: 'jane@example.com',
  });
  expect(makeIdentity('', 'jane@example.com')).toBeNull();
  expect(makeIdentity('Jane', '  ')).toBeNull();
});

test('identityFilePath resolves under ~/.mev', () => {
  expect(identityFilePath('/Users/test')).toBe(
    '/Users/test/.mev/identity.json',
  );
});

test('readState rejects unknown root fields and identity entry fields', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const path = join(dir, 'identity.json');
      await writeFile(
        path,
        JSON.stringify({
          personal: { name: 'A', email: 'a@example.com' },
          extra: null,
        }),
      );
      await expect(readState(path)).rejects.toBeInstanceOf(AppError);

      await writeFile(
        path,
        JSON.stringify({
          personal: { name: 'A', email: 'a@example.com', comment: 'old' },
        }),
      );
      await expect(readState(path)).rejects.toBeInstanceOf(AppError);
    },
    { prefix: 'identity-store-' },
  );
});

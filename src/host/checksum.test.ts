import { expect, test } from 'bun:test';
import { parseSha256Document } from './checksum';

const SHA256 =
  '6a9dd98cb1b85b58ae5df68a8a04fc6a0a8e6fad99c865a3b653a559271abc7c';

test('parses the first hash from a shasum-compatible document', () => {
  expect(parseSha256Document(`${SHA256}  mev\n`, 'mev')).toBe(SHA256);
});

test('normalizes uppercase SHA256 and rejects malformed documents', () => {
  expect(parseSha256Document(SHA256.toUpperCase(), 'mev')).toBe(SHA256);
  expect(() => parseSha256Document('not-a-hash', 'mev')).toThrow(
    'Invalid SHA256 checksum document for mev',
  );
});

import { expect, test } from 'bun:test';
import {
  type EntrySnapshot,
  isEntrySnapshot,
  matchesSnapshot,
} from './entry-snapshot';

const identity = { dev: '1', ino: '2', birthtimeNs: '3' };
const file: EntrySnapshot = {
  identity,
  mode: 0o600,
  kind: 'file',
  mtimeNs: '4',
  digest: 'a'.repeat(64),
};
const directory: EntrySnapshot = {
  identity: { ...identity, ino: '10' },
  mode: 0o700,
  kind: 'directory',
  children: [
    { name: 'first', entry: file },
    { name: 'second', entry: { ...file, identity: { ...identity, ino: '5' } } },
  ],
};

test('snapshot schema rejects unknown state, traversal, duplicate children, and invalid entry data', () => {
  expect(isEntrySnapshot(directory)).toBe(true);
  for (const value of [
    { ...file, unexpected: true },
    { ...file, digest: 'invalid' },
    { ...file, mode: -1 },
    { ...directory, children: [{ name: '../outside', entry: file }] },
    {
      ...directory,
      children: [
        { name: 'duplicate', entry: file },
        { name: 'duplicate', entry: file },
      ],
    },
  ])
    expect(isEntrySnapshot(value)).toBe(false);
});

test('equal content on a different inode or with changed metadata does not prove ownership', () => {
  expect(matchesSnapshot(file, file)).toBe(true);
  expect(
    matchesSnapshot({ ...file, identity: { ...identity, ino: '9' } }, file),
  ).toBe(false);
  expect(matchesSnapshot({ ...file, mode: 0o644 }, file)).toBe(false);
  expect(matchesSnapshot({ ...file, mtimeNs: '5' }, file)).toBe(false);
});

test('cleanup accepts only deletion of recorded descendants, never additions or edits', () => {
  if (directory.kind !== 'directory') throw new Error('directory required');
  const partial = { ...directory, children: directory.children.slice(0, 1) };
  expect(matchesSnapshot(partial, directory)).toBe(false);
  expect(matchesSnapshot(partial, directory, true)).toBe(true);
  expect(
    matchesSnapshot(
      {
        ...directory,
        children: [...directory.children, { name: 'external', entry: file }],
      },
      directory,
      true,
    ),
  ).toBe(false);
  expect(
    matchesSnapshot(
      {
        ...directory,
        children: [
          { name: 'first', entry: { ...file, digest: 'b'.repeat(64) } },
        ],
      },
      directory,
      true,
    ),
  ).toBe(false);
  expect(matchesSnapshot(null, directory, true)).toBe(true);
  expect(matchesSnapshot(file, null, true)).toBe(false);
});

import { expect, test } from 'bun:test';
import { parseInventory } from './inventory';

/** Attributes are NUL-terminated and records close with an empty attribute. */
function porcelain(records: readonly (readonly string[])[]): string {
  return records.map((attributes) => `${attributes.join('\0')}\0\0`).join('');
}

test('reads a branch record', () => {
  const stdout = porcelain([
    ['worktree /work/demo', 'HEAD abc123', 'branch refs/heads/main'],
  ]);

  expect(parseInventory(stdout)).toEqual([
    {
      path: '/work/demo',
      branch: 'main',
      head: 'abc123',
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
  ]);
});

test('does not emit a record for the trailing terminator', () => {
  const stdout = porcelain([
    ['worktree /work/demo', 'HEAD a', 'branch refs/heads/main'],
    ['worktree /work/demo-feature-a', 'HEAD b', 'branch refs/heads/feature/a'],
  ]);

  expect(parseInventory(stdout)).toHaveLength(2);
});

test('reads a detached record that carries no branch', () => {
  const stdout = porcelain([['worktree /work/demo-x', 'HEAD abc', 'detached']]);

  const [entry] = parseInventory(stdout);
  expect(entry?.branch).toBeNull();
  expect(entry?.detached).toBe(true);
  expect(entry?.head).toBe('abc');
});

test('reads a bare record that carries no HEAD', () => {
  const stdout = porcelain([['worktree /work/demo.git', 'bare']]);

  const [entry] = parseInventory(stdout);
  expect(entry?.bare).toBe(true);
  expect(entry?.head).toBeNull();
  expect(entry?.branch).toBeNull();
});

test('keeps spaces in a path and in a lock reason', () => {
  const stdout = porcelain([
    [
      'worktree /work/my demo-feature a',
      'HEAD abc',
      'branch refs/heads/feature/a',
      'locked in use on the road',
    ],
  ]);

  const [entry] = parseInventory(stdout);
  expect(entry?.path).toBe('/work/my demo-feature a');
  expect(entry?.locked).toBe('in use on the road');
});

test('reads a valueless lock and a valued prune reason', () => {
  const stdout = porcelain([
    ['worktree /work/demo-x', 'HEAD abc', 'detached', 'locked'],
    [
      'worktree /work/demo-y',
      'HEAD def',
      'detached',
      'prunable gitdir file points to non-existent location',
    ],
  ]);

  const [locked, prunable] = parseInventory(stdout);
  expect(locked?.locked).toBe(true);
  expect(prunable?.prunable).toBe(
    'gitdir file points to non-existent location',
  );
});

test('reads attributes by label rather than by position', () => {
  const stdout = porcelain([
    ['worktree /work/demo', 'branch refs/heads/main', 'HEAD abc'],
  ]);

  const [entry] = parseInventory(stdout);
  expect(entry?.branch).toBe('main');
  expect(entry?.head).toBe('abc');
});

test('keeps a newline inside a lock reason', () => {
  // -z exists precisely so a value may contain a newline; a line-based parse
  // would split this into a second, bogus attribute.
  const stdout = porcelain([
    ['worktree /work/demo-x', 'HEAD abc', 'detached', 'locked first\nsecond'],
  ]);

  expect(parseInventory(stdout)[0]?.locked).toBe('first\nsecond');
});

test('reads no records from empty output', () => {
  expect(parseInventory('')).toEqual([]);
});

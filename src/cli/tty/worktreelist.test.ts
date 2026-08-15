import { expect, test } from 'bun:test';
import type { Entry } from '../../internal/git/worktree/inventory';
import type { EntryState } from '../../internal/git/worktree/state';
import { renderWorktreeList } from './worktreelist';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    path: '/work/demo',
    branch: 'main',
    head: 'abc1234def',
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
    ...overrides,
  };
}

function state(overrides: Partial<EntryState> = {}): EntryState {
  return {
    entry: entry(),
    dirty: 0,
    tracking: {
      upstream: 'refs/remotes/origin/main',
      ahead: 0,
      behind: 0,
      gone: false,
    },
    ...overrides,
  };
}

/**
 * The STATE cell of the row at `index`. Columns are padded to a fixed width, so
 * the header's own offset locates the column in every body row — splitting on
 * runs of spaces would not, since a cell at the column's full width is followed
 * by a single space.
 */
function stateOf(output: string, index: number): string {
  const lines = output.split('\n');
  const start = (lines[1] ?? '').indexOf('STATE');
  return (lines[3 + index] ?? '').slice(start).trim();
}

test('the header names all three columns', () => {
  const output = renderWorktreeList(false, [state()]);
  const [, header] = output.split('\n');

  expect(header).toContain('WORKTREE');
  expect(header).toContain('BRANCH');
  expect(header).toContain('STATE');
});

test('a nominal worktree leaves STATE empty', () => {
  const output = renderWorktreeList(false, [state()]);
  expect(stateOf(output, 0)).toBe('');
});

test('divergence renders as arrow counts', () => {
  const output = renderWorktreeList(false, [
    state({
      tracking: {
        upstream: 'refs/remotes/origin/main',
        ahead: 2,
        behind: 1,
        gone: false,
      },
    }),
  ]);

  expect(stateOf(output, 0)).toBe('↑2 ↓1');
});

test('uncommitted changes render as a count', () => {
  const output = renderWorktreeList(false, [state({ dirty: 3 })]);
  expect(stateOf(output, 0)).toBe('3 dirty');
});

test('a deleted upstream renders as its own marker', () => {
  const output = renderWorktreeList(false, [
    state({
      entry: entry({ branch: 'feature/a' }),
      tracking: {
        upstream: 'refs/remotes/origin/feature/a',
        ahead: 0,
        behind: 0,
        gone: true,
      },
    }),
  ]);

  expect(stateOf(output, 0)).toBe('(gone)');
});

test('locked and prunable moved to STATE, leaving BRANCH as identity alone', () => {
  const output = renderWorktreeList(false, [
    state({ entry: entry({ branch: 'feature/a', locked: 'on the road' }) }),
  ]);
  const [, , , row] = output.split('\n');

  expect(stateOf(output, 0)).toBe('(locked)');
  // The branch column carries the name and nothing appended to it.
  expect(row).toContain('feature/a');
});

test('an unread working tree renders as unknown rather than clean', () => {
  const output = renderWorktreeList(false, [state({ dirty: null })]);
  expect(stateOf(output, 0)).toBe('?');
});

test('a prunable worktree accounts for its own unread working tree', () => {
  const output = renderWorktreeList(false, [
    state({
      entry: entry({ branch: 'feature/a', prunable: true }),
      dirty: null,
    }),
  ]);

  // The marker already explains the missing count, so the bare `?` is noise.
  expect(stateOf(output, 0)).toBe('(prunable)');
});

test('a detached worktree shows no tracking state', () => {
  const output = renderWorktreeList(false, [
    state({
      entry: entry({ branch: null, detached: true }),
      tracking: null,
      dirty: 2,
    }),
  ]);
  const [, , , row] = output.split('\n');

  expect(row).toContain('(detached at abc1234)');
  expect(stateOf(output, 0)).toBe('2 dirty');
});

test('nothing is styled when the sink is not a terminal', () => {
  const output = renderWorktreeList(false, [
    state({ dirty: 4, entry: entry({ locked: true }) }),
  ]);

  expect(output).not.toContain('\x1b[');
});

test('a terminal sink styles the branch and the markers', () => {
  const output = renderWorktreeList(true, [
    state({ dirty: 4, entry: entry({ branch: 'feature/a', locked: true }) }),
  ]);

  expect(output).toContain('\x1b[');
});

test('a pre-styled branch cell does not widen its column', () => {
  const rows = [
    state({ entry: entry({ path: '/work/demo', branch: 'main' }) }),
    state({
      entry: entry({ path: '/work/demo-feature-a', branch: 'feature/a' }),
    }),
  ];
  const plain = renderWorktreeList(false, rows);
  const styled = renderWorktreeList(true, rows);

  // Escape bytes are invisible, so stripping them must reproduce the plain
  // layout exactly — the column widths cannot have counted them.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR sequences is the point.
  expect(styled.replaceAll(/\x1b\[\d+m/g, '')).toBe(plain);
});

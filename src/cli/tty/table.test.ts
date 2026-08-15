import { expect, test } from 'bun:test';
import { makeStyle } from './style';
import { renderTable } from './table';

const plain = makeStyle(false);

/** The dash run under each column, in order. Columns are single-space joined. */
function rules(output: string): string[] {
  const [, separator] = output.split('\n');
  return (separator ?? '').split(' ').filter((segment) => segment !== '');
}

test('every column underlines to its widest cell, including the last', () => {
  const output = renderTable(
    plain,
    [{ header: 'WORKTREE' }, { header: 'BRANCH' }],
    [['worktree-demo', 'feat/internal-worktree']],
  );

  // BRANCH is 6 characters; the data cell is 22. The underline must reach the
  // data, not stop at the header — that gap is what made the last column's
  // rule look truncated next to a longer branch name.
  expect(rules(output)).toEqual([
    '─'.repeat('worktree-demo'.length),
    '─'.repeat('feat/internal-worktree'.length),
  ]);
});

test('a header wider than every cell still gets its own full underline', () => {
  const output = renderTable(
    plain,
    [{ header: 'NAME' }, { header: 'DESCRIPTION' }],
    [['a', 'x']],
  );

  expect(rules(output)).toEqual([
    '─'.repeat('NAME'.length),
    '─'.repeat('DESCRIPTION'.length),
  ]);
});

test('a pre-styled final cell does not widen its column', () => {
  const tty = makeStyle(true);
  const colored = tty.green('●');
  // The final column is the one callers may style themselves (the identities
  // renderer colors its active marker), so its raw length carries escape bytes
  // the terminal never prints.
  expect(colored.length).toBeGreaterThan(1);

  const output = renderTable(
    tty,
    [{ header: 'NAME' }, { header: 'ACTIVE' }],
    [['a', colored]],
  );
  const [, separator] = output.split('\n');
  const rule = (separator ?? '').match(/─+/g)?.at(-1) ?? '';

  // ACTIVE is 6 visible characters and the cell is 1, so the rule stays at 6
  // rather than stretching to the escape-inflated length.
  expect(rule.length).toBe('ACTIVE'.length);
});

test('a pre-styled final cell still stretches the rule to its visible width', () => {
  const tty = makeStyle(true);
  const output = renderTable(
    tty,
    [{ header: 'WORKTREE' }, { header: 'BRANCH' }],
    [['worktree-demo', tty.green('feat/internal-worktree')]],
  );
  const [, separator] = output.split('\n');
  const rule = (separator ?? '').match(/─+/g)?.at(-1) ?? '';

  expect(rule.length).toBe('feat/internal-worktree'.length);
});

test('the last column is appended unpadded so its own styling is untouched', () => {
  const output = renderTable(
    plain,
    [{ header: 'A' }, { header: 'B' }],
    [['x', 'yy']],
  );
  const [, , body] = output.split('\n');

  expect(body?.trimEnd().endsWith('yy')).toBe(true);
});

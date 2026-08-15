import type { Entry } from '../../internal/git/worktree/inventory';
import { displayName, layoutFor } from '../../internal/git/worktree/layout';
import type { EntryState } from '../../internal/git/worktree/state';
import { makeStyle, type Style } from './style';
import { renderTable } from './table';

/**
 * Names are shown as the bare directory name for worktrees sitting beside the
 * main one, and every name shown is accepted back as a token by move and
 * remove. BRANCH carries identity alone; STATE carries every condition a
 * worktree command acts on, so one family of markers stays in one column.
 *
 * Color follows status rather than column: the worktree name is a plain
 * identifier (dim), the branch is what matters (green, following git's own
 * convention), divergence is informational (dim), and the conditions a command
 * refuses or resolves on are marked — dirty, locked, and a deleted upstream in
 * yellow because each has a next step, prunable in red because git's own
 * registration is already broken. A nominal row leaves STATE empty, which is
 * what makes the rows needing attention visible.
 */
export function renderWorktreeList(
  isTTY: boolean,
  states: readonly EntryState[],
): string {
  const c = makeStyle(isTTY);
  const first = states[0];
  if (!first) return '\n';

  const layout = layoutFor(first.entry.path);
  const rows = states.map((state) => [
    displayName(layout, state.entry.path),
    branchCell(c, state.entry),
    stateCell(c, state),
  ]);
  const table = renderTable(
    c,
    [
      { header: 'WORKTREE', style: c.dim },
      { header: 'BRANCH' },
      { header: 'STATE' },
    ],
    rows,
  );
  return `\n${table}\n\n`;
}

function branchCell(c: Style, entry: Entry): string {
  if (entry.branch !== null) return c.green(entry.branch);
  return c.dim(
    entry.head === null
      ? '(detached)'
      : `(detached at ${entry.head.slice(0, 7)})`,
  );
}

function stateCell(c: Style, state: EntryState): string {
  const { entry, tracking, dirty } = state;
  return [
    tracking !== null && tracking.ahead > 0
      ? c.dim(`↑${tracking.ahead}`)
      : null,
    tracking !== null && tracking.behind > 0
      ? c.dim(`↓${tracking.behind}`)
      : null,
    dirty !== null && dirty > 0 ? c.yellow(`${dirty} dirty`) : null,
    // The prunable marker already accounts for an unread working tree, so the
    // unknown count is only worth showing when nothing else explains it.
    dirty === null && entry.prunable === null ? c.dim('?') : null,
    tracking?.gone === true ? c.bold(c.yellow('(gone)')) : null,
    entry.locked === null ? null : c.bold(c.yellow('(locked)')),
    entry.prunable === null ? null : c.bold(c.red('(prunable)')),
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

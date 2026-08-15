import type { Entry } from '../../internal/git/worktree/inventory';
import { displayName, layoutFor } from '../../internal/git/worktree/layout';
import { makeStyle, type Style } from './style';
import { renderTable } from './table';

/**
 * Names are shown as the bare directory name for worktrees sitting beside the
 * main one, and every name shown is accepted back as a token by move and
 * remove. Color follows status rather than column: the worktree name is a
 * plain identifier (dim), the branch is what matters (green, following git's
 * own convention), and the two markers are the exact conditions move and
 * remove refuse on — locked (yellow, recoverable by unlocking) and prunable
 * (red, git's own registration state is already broken) — so seeing them here
 * is what keeps the refusal from being a surprise.
 */
export function renderWorktreeList(
  isTTY: boolean,
  entries: readonly Entry[],
): string {
  const c = makeStyle(isTTY);
  const main = entries[0];
  if (!main) return '\n';

  const layout = layoutFor(main.path);
  const rows = entries.map((entry) => [
    displayName(layout, entry.path),
    branchCell(c, entry),
  ]);
  const table = renderTable(
    c,
    [{ header: 'WORKTREE', style: c.dim }, { header: 'BRANCH' }],
    rows,
  );
  return `\n${table}\n\n`;
}

function branchCell(c: Style, entry: Entry): string {
  const head =
    entry.branch !== null
      ? c.green(entry.branch)
      : c.dim(
          entry.head === null
            ? '(detached)'
            : `(detached at ${entry.head.slice(0, 7)})`,
        );
  const markers = [
    entry.locked === null ? null : c.bold(c.yellow('(locked)')),
    entry.prunable === null ? null : c.bold(c.red('(prunable)')),
  ].filter((marker): marker is string => marker !== null);
  return [head, ...markers].join(' ');
}

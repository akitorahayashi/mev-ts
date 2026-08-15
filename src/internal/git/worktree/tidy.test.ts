import { expect, test } from 'bun:test';
import { CommandLineError } from '../../../errors';
import type { CommandRunner } from '../../../host/command';
import type { Entry, Inventory } from './inventory';
import { layoutFor } from './layout';
import type { Tracking } from './state';
import { classify, tidyWorktrees } from './tidy';

const dummyRunner: CommandRunner = {
  async run() {
    throw new Error('CommandRunner should not be called');
  },
};

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    path: '/work/demo-feature-a',
    branch: 'feature/a',
    head: 'abc1234',
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
    ...overrides,
  };
}

const main = entry({ path: '/work/demo', branch: 'main' });

function inventoryOf(...linked: Entry[]): Inventory {
  return {
    entries: [main, ...linked],
    main,
    layout: layoutFor(main.path),
  };
}

function gone(upstream = 'refs/remotes/origin/feature/a'): Tracking {
  return { upstream, ahead: 0, behind: 0, gone: true };
}

function tracked(branch: string, state: Tracking): Map<string, Tracking> {
  return new Map([[branch, state]]);
}

/** The verdict for the one linked worktree the fixtures build. */
function verdictFor(inventory: Inventory, tracking: Map<string, Tracking>) {
  const decisions = classify(inventory, tracking, 'main');
  return decisions[0]?.verdict;
}

test('a worktree whose remote branch was deleted is removable', () => {
  const verdict = verdictFor(
    inventoryOf(entry()),
    tracked('feature/a', gone()),
  );

  expect(verdict).toEqual({ kind: 'remove' });
});

test('a worktree whose upstream still exists is not a candidate at all', () => {
  const decisions = classify(
    inventoryOf(entry()),
    tracked('feature/a', {
      upstream: 'refs/remotes/origin/feature/a',
      ahead: 0,
      behind: 0,
      gone: false,
    }),
    'main',
  );

  // Not reported either way: only gone-upstream worktrees are this command's
  // business, so a healthy one is absent rather than skipped.
  expect(decisions).toEqual([]);
});

test('a branch with no tracking information is not a candidate', () => {
  expect(classify(inventoryOf(entry()), new Map(), 'main')).toEqual([]);
});

test('a detached worktree is not a candidate', () => {
  const decisions = classify(
    inventoryOf(entry({ branch: null, detached: true })),
    tracked('feature/a', gone()),
    'main',
  );

  expect(decisions).toEqual([]);
});

test('the main worktree is never removed', () => {
  const decisions = classify(
    inventoryOf(),
    tracked('main', gone('refs/remotes/origin/main')),
    'main',
  );

  expect(decisions[0]?.verdict).toEqual({
    kind: 'skip',
    reason: 'the main worktree is never removed',
  });
});

test('a worktree holding the default branch is skipped', () => {
  const linked = entry({ path: '/work/demo-main', branch: 'main' });
  const inventory: Inventory = {
    entries: [entry({ path: '/work/demo', branch: 'dev' }), linked],
    main: entry({ path: '/work/demo', branch: 'dev' }),
    layout: layoutFor('/work/demo'),
  };
  const decisions = classify(
    inventory,
    tracked('main', gone('refs/remotes/origin/main')),
    'main',
  );

  expect(decisions[0]?.verdict).toEqual({
    kind: 'skip',
    reason: "'main' is the default branch",
  });
});

test('a prunable worktree is skipped toward prune, not removal', () => {
  const verdict = verdictFor(
    inventoryOf(entry({ prunable: true })),
    tracked('feature/a', gone()),
  );

  expect(verdict).toEqual({
    kind: 'skip',
    reason:
      'registered but its directory is missing — run `git worktree prune`',
  });
});

test('a locked worktree is skipped, carrying its reason when it has one', () => {
  expect(
    verdictFor(
      inventoryOf(entry({ locked: true })),
      tracked('feature/a', gone()),
    ),
  ).toEqual({ kind: 'skip', reason: 'locked' });

  expect(
    verdictFor(
      inventoryOf(entry({ locked: 'on the road' })),
      tracked('feature/a', gone()),
    ),
  ).toEqual({ kind: 'skip', reason: 'locked: on the road' });
});

test('a branch tracking a deleted local branch is skipped', () => {
  // A local upstream reports gone too, but its disappearance is no evidence
  // that the work was ever merged anywhere.
  const verdict = verdictFor(
    inventoryOf(entry()),
    tracked('feature/a', gone('refs/heads/dev')),
  );

  expect(verdict).toEqual({
    kind: 'skip',
    reason: "upstream 'refs/heads/dev' is not a remote branch",
  });
});

test('a gone branch with no upstream ref recorded is skipped', () => {
  const verdict = verdictFor(
    inventoryOf(entry()),
    tracked('feature/a', gone()),
  );
  expect(verdict).toEqual({ kind: 'remove' });

  expect(
    verdictFor(
      inventoryOf(entry()),
      tracked('feature/a', { upstream: null, ahead: 0, behind: 0, gone: true }),
    ),
  ).toEqual({
    kind: 'skip',
    reason: "upstream 'none' is not a remote branch",
  });
});

test('rejects a worktree name before running a command', async () => {
  // tidy chooses its own targets; naming one would suggest it does not.
  await expect(
    tidyWorktrees(dummyRunner, ['feature/a']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('the argument rejection names the one option tidy accepts', async () => {
  await expect(tidyWorktrees(dummyRunner, ['--force'])).rejects.toThrow(
    "Unexpected argument '--force': tidy takes no arguments other than --dry-run.",
  );
});

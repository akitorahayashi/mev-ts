import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { ProvisioningError } from '../../../src/errors';
import { tidyWorktrees } from '../../../src/internal/git/worktree/tidy';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const ok = { code: 0, stdout: '', stderr: '' };
const clean = { code: 0, stdout: '', stderr: '' };

const listArgs = ['worktree', 'list', '--porcelain', '-z'];
const headArgs = ['rev-parse', '--abbrev-ref', 'origin/HEAD'];
const fetchArgs = ['fetch', '--prune', 'origin'];
const trackingArgs = [
  'for-each-ref',
  '--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track,nobracket)',
  'refs/heads/',
];

function statusArgs(path: string) {
  return [
    '-C',
    path,
    '--no-optional-locks',
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=normal',
  ];
}

function porcelain(records: readonly (readonly string[])[]) {
  return {
    code: 0,
    stdout: records.map((a) => `${a.join('\0')}\0\0`).join(''),
    stderr: '',
  };
}

/** The main worktree on `main`, plus a linked worktree per entry given. */
function inventoryOf(
  sandbox: string,
  linked: readonly (readonly [string, string, ...string[]])[] = [],
) {
  return porcelain([
    [
      `worktree ${join(sandbox, 'demo')}`,
      'HEAD aaaaaaa',
      'branch refs/heads/main',
    ],
    ...linked.map(([name, branch, ...extra]) => [
      `worktree ${join(sandbox, name)}`,
      'HEAD bbbbbbbccccccc',
      `branch refs/heads/${branch}`,
      ...extra,
    ]),
  ]);
}

const head = { code: 0, stdout: 'origin/main\n', stderr: '' };

function tracking(lines: readonly string[]) {
  return { code: 0, stdout: lines.join('\n'), stderr: '' };
}

/** main up to date, plus one gone feature branch. */
const goneFeatureA = tracking([
  'main\0refs/remotes/origin/main\0',
  'feature/a\0refs/remotes/origin/feature/a\0gone',
]);

const sandboxTest = sandboxedTest('mev-worktree-tidy-');

sandboxTest('removes a merged worktree and its branch', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
      head,
      ok,
      goneFeatureA,
      clean,
      ok,
      ok,
    ],
    calls,
  );

  await tidyWorktrees(run, []);

  expect(calls.map((call) => call.args)).toEqual([
    listArgs,
    headArgs,
    fetchArgs,
    trackingArgs,
    statusArgs(join(sandbox, 'demo-feature-a')),
    ['worktree', 'remove', join(sandbox, 'demo-feature-a')],
    ['branch', '-D', '--', 'feature/a'],
  ]);
});

sandboxTest(
  'the inventory and default branch are read before the network',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox),
        { code: 128, stdout: '', stderr: 'fatal: ambiguous argument' },
      ],
      calls,
    );

    await expect(tidyWorktrees(run, [])).rejects.toBeInstanceOf(
      ProvisioningError,
    );
    // No fetch: an unset origin/HEAD is settled without a round-trip.
    expect(calls.map((call) => call.args)).toEqual([listArgs, headArgs]);
  },
);

sandboxTest('reports the tip a branch deletion discarded', async (sandbox) => {
  const lines: string[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
      head,
      ok,
      goneFeatureA,
      clean,
      ok,
      ok,
    ],
    [],
  );

  await tidyWorktrees(run, [], (line) => lines.push(line));

  const report = lines.join('');
  expect(report).toContain('bbbbbbb');
  expect(report).toContain('git branch feature/a bbbbbbbccccccc');
});

sandboxTest('a dirty worktree is skipped, not removed', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const lines: string[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
      head,
      ok,
      goneFeatureA,
      { code: 0, stdout: 'M  a.txt\0?? b.txt\0', stderr: '' },
    ],
    calls,
  );

  await tidyWorktrees(run, [], (line) => lines.push(line));

  expect(calls.map((call) => call.args).slice(4)).toEqual([
    statusArgs(join(sandbox, 'demo-feature-a')),
  ]);
  expect(lines.join('')).toContain('2 uncommitted change(s)');
});

sandboxTest(
  'a locked worktree is skipped before any status probe',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox, [
          ['demo-feature-a', 'feature/a', 'locked on the road'],
        ]),
        head,
        ok,
        goneFeatureA,
      ],
      calls,
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    // The free check spends no spawn on a worktree it has already refused.
    expect(calls).toHaveLength(4);
    expect(lines.join('')).toContain('locked: on the road');
  },
);

sandboxTest(
  'a worktree whose upstream still exists is left alone and unreported',
  async (sandbox) => {
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
        head,
        ok,
        tracking([
          'main\0refs/remotes/origin/main\0',
          'feature/a\0refs/remotes/origin/feature/a\0ahead 2',
        ]),
      ],
      [],
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    const report = lines.join('');
    expect(report).not.toContain('demo-feature-a');
    expect(report).toContain('Removed 0 worktree(s), skipped 0.');
  },
);

sandboxTest(
  'the default branch fast-forwards from the ref already fetched',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox),
        head,
        ok,
        tracking(['main\0refs/remotes/origin/main\0behind 3']),
        clean,
        ok,
      ],
      calls,
    );

    await tidyWorktrees(run, []);

    expect(calls.map((call) => call.args).slice(-2)).toEqual([
      statusArgs(join(sandbox, 'demo')),
      ['-C', join(sandbox, 'demo'), 'merge', '--ff-only', 'origin/main'],
    ]);
  },
);

sandboxTest(
  'an up-to-date default branch is left alone with a stated reason',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox),
        head,
        ok,
        tracking(['main\0refs/remotes/origin/main\0']),
      ],
      calls,
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    expect(calls).toHaveLength(4);
    expect(lines.join('')).toContain("'main' is already up to date");
  },
);

sandboxTest(
  'unpushed commits on the default branch stop the update',
  async (sandbox) => {
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox),
        head,
        ok,
        tracking(['main\0refs/remotes/origin/main\0ahead 1, behind 2']),
      ],
      [],
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    expect(lines.join('')).toContain("'main' has 1 unpushed commit(s)");
  },
);

sandboxTest(
  'a main worktree on another branch is never checked out',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        porcelain([
          [
            `worktree ${join(sandbox, 'demo')}`,
            'HEAD aaaaaaa',
            'branch refs/heads/dev',
          ],
        ]),
        head,
        ok,
        tracking(['main\0refs/remotes/origin/main\0behind 3']),
      ],
      calls,
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    expect(calls).toHaveLength(4);
    expect(lines.join('')).toContain(
      "the main worktree is on 'dev', not 'main'",
    );
  },
);

sandboxTest(
  'a dirty main worktree stops the update short of merging',
  async (sandbox) => {
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox),
        head,
        ok,
        tracking(['main\0refs/remotes/origin/main\0behind 3']),
        { code: 0, stdout: 'M  a.txt\0', stderr: '' },
      ],
      [],
    );

    await tidyWorktrees(run, [], (line) => lines.push(line));

    expect(lines.join('')).toContain(
      'the main worktree has 1 uncommitted change(s)',
    );
  },
);

test('refuses a bare repository before reaching the network', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [porcelain([['worktree /work/demo.git', 'bare']])],
    calls,
  );

  await expect(tidyWorktrees(run, [])).rejects.toThrow(
    'Bare repositories are not supported.',
  );
  expect(calls).toHaveLength(1);
});

sandboxTest(
  'a dry run decides everything and changes nothing',
  async (sandbox) => {
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const run = sequenceRunner(
      [
        inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
        head,
        ok,
        tracking([
          'main\0refs/remotes/origin/main\0behind 3',
          'feature/a\0refs/remotes/origin/feature/a\0gone',
        ]),
        clean,
        clean,
      ],
      calls,
    );

    await tidyWorktrees(run, ['--dry-run'], (line) => lines.push(line));

    // The fetch stays: a preview off stale remote-tracking refs would answer for
    // a different repository than the real run. Nothing after it mutates.
    expect(calls.map((call) => call.args)).toEqual([
      listArgs,
      headArgs,
      fetchArgs,
      trackingArgs,
      statusArgs(join(sandbox, 'demo-feature-a')),
      statusArgs(join(sandbox, 'demo')),
    ]);

    const report = lines.join('');
    expect(report).toContain(
      'Would remove demo-feature-a and delete feature/a',
    );
    expect(report).toContain('Would remove 1 worktree(s), skipped 0.');
    expect(report).toContain("Would fast-forward 'main' by 3 commit(s).");
  },
);

sandboxTest('-n is the short form of --dry-run', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]),
      head,
      ok,
      goneFeatureA,
      clean,
    ],
    calls,
  );

  await tidyWorktrees(run, ['-n']);

  expect(calls.map((call) => call.args)).not.toContainEqual([
    'worktree',
    'remove',
    join(sandbox, 'demo-feature-a'),
  ]);
});

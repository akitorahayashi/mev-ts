import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import type { Entry } from '../../../src/internal/git/worktree/inventory';
import { readStates } from '../../../src/internal/git/worktree/state';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';

const ok = { code: 0, stdout: '', stderr: '' };

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

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    path: '/work/demo',
    branch: 'main',
    head: 'abc1234',
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
    ...overrides,
  };
}

test('one tracking listing serves every worktree, one status probe each', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      {
        code: 0,
        stdout: 'main\0refs/remotes/origin/main\0behind 1\n',
        stderr: '',
      },
      ok,
      ok,
    ],
    calls,
  );

  await readStates(run, [
    entry(),
    entry({ path: '/work/demo-feature-a', branch: 'feature/a' }),
  ]);

  expect(calls.map((call) => call.args)).toEqual([
    trackingArgs,
    statusArgs('/work/demo'),
    statusArgs('/work/demo-feature-a'),
  ]);
});

test('tracking state is attached to the branch that carries it', async () => {
  const run = sequenceRunner(
    [
      {
        code: 0,
        stdout: [
          'main\0refs/remotes/origin/main\0',
          'feature/a\0refs/remotes/origin/feature/a\0gone',
        ].join('\n'),
        stderr: '',
      },
      ok,
      ok,
    ],
    [],
  );

  const states = await readStates(run, [
    entry(),
    entry({ path: '/work/demo-feature-a', branch: 'feature/a' }),
  ]);

  expect(states[0]?.tracking?.gone).toBe(false);
  expect(states[1]?.tracking?.gone).toBe(true);
});

test('a detached worktree carries no tracking state', async () => {
  const run = sequenceRunner([{ code: 0, stdout: '', stderr: '' }, ok], []);

  const states = await readStates(run, [
    entry({ branch: null, detached: true }),
  ]);

  expect(states[0]?.tracking).toBeNull();
});

test('a prunable worktree is not probed and reports an unknown count', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([{ code: 0, stdout: '', stderr: '' }], calls);

  const states = await readStates(run, [entry({ prunable: true })]);

  // The directory is gone, so a status spawn could only fail.
  expect(calls.map((call) => call.args)).toEqual([trackingArgs]);
  expect(states[0]?.dirty).toBeNull();
});

test('an unreadable working tree reports unknown rather than clean', async () => {
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 128, stdout: '', stderr: 'fatal: not a git repository' },
    ],
    [],
  );

  const states = await readStates(run, [entry()]);

  expect(states[0]?.dirty).toBeNull();
});

test('a failed tracking listing is reported rather than read as no branches', async () => {
  const run = sequenceRunner(
    [{ code: 128, stdout: '', stderr: 'fatal: not a git repository' }],
    [],
  );

  await expect(readStates(run, [entry()])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('results stay in inventory order despite concurrent probes', async () => {
  const paths = Array.from({ length: 12 }, (_, index) => `/work/demo-${index}`);
  const run = sequenceRunner(
    [{ code: 0, stdout: '', stderr: '' }, ...paths.map(() => ok)],
    [],
  );

  const states = await readStates(
    run,
    paths.map((path) => entry({ path, branch: null })),
  );

  expect(states.map((state) => state.entry.path)).toEqual(paths);
});

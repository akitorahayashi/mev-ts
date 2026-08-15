import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import {
  bunCommandRunner,
  type CommandRunner,
} from '../../../src/host/command';
import { addWorktrees } from '../../../src/internal/git/worktree/add';
import { readInventory } from '../../../src/internal/git/worktree/inventory';
import { moveWorktree } from '../../../src/internal/git/worktree/move';
import { removeWorktrees } from '../../../src/internal/git/worktree/remove';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const ok = { code: 0, stdout: '', stderr: '' };

const listArgs = ['worktree', 'list', '--porcelain', '-z'];
const refArgs = [
  'for-each-ref',
  '--format=%(refname)',
  'refs/heads/',
  'refs/remotes/',
];

function porcelain(records: readonly (readonly string[])[]) {
  return {
    code: 0,
    stdout: records.map((a) => `${a.join('\0')}\0\0`).join(''),
    stderr: '',
  };
}

/** The main worktree plus any linked ones, all under the sandbox. */
function inventoryOf(
  sandbox: string,
  linked: readonly (readonly [string, string])[] = [],
) {
  return porcelain([
    [`worktree ${join(sandbox, 'demo')}`, 'HEAD a', 'branch refs/heads/main'],
    ...linked.map(([name, branch]) => [
      `worktree ${join(sandbox, name)}`,
      'HEAD b',
      `branch refs/heads/${branch}`,
    ]),
  ]);
}

function refs(names: readonly string[]) {
  return { code: 0, stdout: `${names.join('\n')}\n`, stderr: '' };
}

const sandboxTest = sandboxedTest('mev-worktree-');

sandboxTest('creates a branch and its worktree', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox), refs(['refs/heads/main']), ok],
    calls,
  );

  await addWorktrees(run, ['feature/a']);

  expect(calls).toEqual([
    { command: 'git', args: listArgs, stdout: undefined, stderr: undefined },
    { command: 'git', args: refArgs, stdout: undefined, stderr: undefined },
    {
      command: 'git',
      args: [
        'worktree',
        'add',
        '-b',
        'feature/a',
        join(sandbox, 'demo-feature-a'),
      ],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

sandboxTest('checks out a branch that already exists', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox),
      refs(['refs/heads/main', 'refs/heads/feature/a']),
      ok,
    ],
    calls,
  );

  await addWorktrees(run, ['feature/a']);

  expect(calls.map((call) => call.args).at(-1)).toEqual([
    'worktree',
    'add',
    join(sandbox, 'demo-feature-a'),
    'feature/a',
  ]);
});

sandboxTest('tracks a branch that exists only on a remote', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox),
      refs(['refs/heads/main', 'refs/remotes/origin/feature/a']),
      ok,
    ],
    calls,
  );

  await addWorktrees(run, ['feature/a']);

  // Without --track, -b would branch from HEAD and the remote work would be
  // silently left behind.
  expect(calls.map((call) => call.args).at(-1)).toEqual([
    'worktree',
    'add',
    '--track',
    '-b',
    'feature/a',
    join(sandbox, 'demo-feature-a'),
    'origin/feature/a',
  ]);
});

sandboxTest('ignores the remote HEAD symref', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox),
      refs(['refs/heads/main', 'refs/remotes/origin/HEAD']),
      ok,
    ],
    calls,
  );

  await addWorktrees(run, ['HEAD-ish']);

  expect(calls.map((call) => call.args).at(-1)?.[2]).toBe('-b');
});

sandboxTest('refuses a branch carried by two remotes', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox),
      refs([
        'refs/heads/main',
        'refs/remotes/origin/feature/a',
        'refs/remotes/fork/feature/a',
      ]),
    ],
    calls,
  );

  await expect(addWorktrees(run, ['feature/a'])).rejects.toThrow(
    'exists on more than one remote',
  );
  expect(calls.map((call) => call.args)).toEqual([listArgs, refArgs]);
});

sandboxTest('rolls back the worktrees it already created', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox),
      refs(['refs/heads/main']),
      ok,
      ok,
      { code: 1, stdout: '', stderr: 'boom' },
      ok,
      ok,
      ok,
      ok,
    ],
    calls,
  );

  await expect(
    addWorktrees(run, ['feature/a', 'feature/b', 'feature/c']),
  ).rejects.toBeInstanceOf(ProvisioningError);

  expect(calls.map((call) => call.args).slice(5)).toEqual([
    ['worktree', 'remove', join(sandbox, 'demo-feature-b')],
    ['branch', '-D', '--', 'feature/b'],
    ['worktree', 'remove', join(sandbox, 'demo-feature-a')],
    ['branch', '-D', '--', 'feature/a'],
  ]);
});

sandboxTest('refuses a branch already checked out', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [['demo-signup-v2', 'feature/signup']]),
      refs(['refs/heads/main', 'refs/heads/feature/signup']),
    ],
    calls,
  );

  await expect(addWorktrees(run, ['feature/signup'])).rejects.toThrow(
    "Branch 'feature/signup' is already checked out at 'demo-signup-v2'.",
  );
  expect(calls.map((call) => call.args)).toEqual([listArgs, refArgs]);
});

sandboxTest('refuses two branches sharing a directory', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox), refs(['refs/heads/main'])],
    calls,
  );

  await expect(addWorktrees(run, ['feature/a', 'feature-a'])).rejects.toThrow(
    "both map to 'demo-feature-a'",
  );
});

sandboxTest('refuses branches colliding only by case', async (sandbox) => {
  const run = sequenceRunner(
    [inventoryOf(sandbox), refs(['refs/heads/main'])],
    [],
  );

  // Distinct strings, one directory on a case-insensitive filesystem.
  await expect(
    addWorktrees(run, ['feature/A', 'feature/a']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects an invalid branch name before running any command', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([], calls);

  await expect(addWorktrees(run, ['@{-1}'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
  expect(calls).toEqual([]);
});

test('rejects an empty branch list before running any command', async () => {
  const calls: RecordedCall[] = [];
  await expect(addWorktrees(sequenceRunner([], calls), [])).rejects.toThrow(
    'At least one branch is required.',
  );
  expect(calls).toEqual([]);
});

sandboxTest('moves a worktree named by its suffix', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox, [['demo-feature-signup', 'feature/signup']]), ok],
    calls,
  );

  await moveWorktree(run, ['feature-signup', 'signup-v2']);

  expect(calls.map((call) => call.args)).toEqual([
    listArgs,
    [
      'worktree',
      'move',
      join(sandbox, 'demo-feature-signup'),
      join(sandbox, 'demo-signup-v2'),
    ],
  ]);
});

sandboxTest('moves a worktree named by its branch', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox, [['demo-feature-signup', 'feature/signup']]), ok],
    calls,
  );

  await moveWorktree(run, ['feature/signup', 'signup-v2']);

  expect(calls.map((call) => call.args).at(-1)?.[3]).toBe(
    join(sandbox, 'demo-signup-v2'),
  );
});

sandboxTest('refuses to move the main worktree', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([inventoryOf(sandbox)], calls);

  await expect(moveWorktree(run, ['main', 'elsewhere'])).rejects.toThrow(
    'Cannot move the main worktree.',
  );
  expect(calls.map((call) => call.args)).toEqual([listArgs]);
});

sandboxTest(
  'names the known worktrees when nothing matches',
  async (sandbox) => {
    const run = sequenceRunner(
      [inventoryOf(sandbox, [['demo-feature-a', 'feature/a']])],
      [],
    );

    await expect(moveWorktree(run, ['typo', 'x'])).rejects.toThrow(
      "No worktree matches 'typo'. Known worktrees: demo, demo-feature-a.",
    );
  },
);

sandboxTest('removes several worktrees named differently', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      inventoryOf(sandbox, [
        ['demo-feature-a', 'feature/a'],
        ['demo-feature-b', 'feature/b'],
      ]),
      ok,
      ok,
    ],
    calls,
  );

  await removeWorktrees(run, ['feature-a', 'feature/b']);

  expect(calls.map((call) => call.args)).toEqual([
    listArgs,
    ['worktree', 'remove', join(sandbox, 'demo-feature-a')],
    ['worktree', 'remove', join(sandbox, 'demo-feature-b')],
  ]);
});

sandboxTest('removes a worktree once per distinct target', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]), ok],
    calls,
  );

  // The branch and the suffix name the same worktree.
  await removeWorktrees(run, ['feature/a', 'feature-a']);

  expect(calls.map((call) => call.args)).toHaveLength(2);
});

sandboxTest('passes --force through to git', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]), ok],
    calls,
  );

  await removeWorktrees(run, ['feature-a', '--force']);

  expect(calls.map((call) => call.args).at(-1)).toEqual([
    'worktree',
    'remove',
    '--force',
    join(sandbox, 'demo-feature-a'),
  ]);
});

sandboxTest('reports every unmatched target at once', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([inventoryOf(sandbox)], calls);

  await expect(removeWorktrees(run, ['typo-a', 'typo-b'])).rejects.toThrow(
    'No worktree matches: typo-a, typo-b.',
  );
  expect(calls.map((call) => call.args)).toEqual([listArgs]);
});

sandboxTest('refuses to remove a locked worktree', async (sandbox) => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      porcelain([
        [
          `worktree ${join(sandbox, 'demo')}`,
          'HEAD a',
          'branch refs/heads/main',
        ],
        [
          `worktree ${join(sandbox, 'demo-feature-a')}`,
          'HEAD b',
          'branch refs/heads/feature/a',
          'locked on the road',
        ],
      ]),
    ],
    calls,
  );

  await expect(removeWorktrees(run, ['feature-a'])).rejects.toThrow(
    "'demo-feature-a' is locked: on the road.",
  );
  expect(calls.map((call) => call.args)).toEqual([listArgs]);
});

sandboxTest('names the branches a removal leaves behind', async (sandbox) => {
  const lines: string[] = [];
  const run = sequenceRunner(
    [inventoryOf(sandbox, [['demo-feature-a', 'feature/a']]), ok],
    [],
  );

  await removeWorktrees(run, ['feature-a'], (line) => lines.push(line));

  expect(lines.at(-1)).toContain('git branch -d feature/a');
});

test('reports a listing failure instead of parsing an empty inventory', async () => {
  const run = sequenceRunner(
    [{ code: 128, stdout: '', stderr: 'fatal: not a git repository' }],
    [],
  );

  await expect(removeWorktrees(run, ['anything'])).rejects.toThrow(
    'fatal: not a git repository',
  );
});

test('refuses a bare repository', async () => {
  const run = sequenceRunner(
    [porcelain([['worktree /work/demo.git', 'bare']])],
    [],
  );

  await expect(removeWorktrees(run, ['anything'])).rejects.toThrow(
    'Bare repositories are not supported.',
  );
});

/**
 * A runner pinned to `cwd` with the developer's own git configuration
 * neutralized, mirroring the branches integration test.
 */
function repoRunner(cwd: string): CommandRunner {
  const isolation = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'mev test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'mev test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  return {
    run: (command, args, options) =>
      bunCommandRunner.run(command, args, {
        ...options,
        cwd,
        env: { ...options?.env, ...isolation },
        stdout: 'pipe',
        stderr: 'pipe',
      }),
  };
}

async function git(run: CommandRunner, args: readonly string[]): Promise<void> {
  const result = await run.run('git', args);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

// Exercised against real git because the subject is git's own -z porcelain
// framing: expectations written against a fake would only restate the parser.
sandboxTest('parses the porcelain output real git emits', async (dir) => {
  const setup = repoRunner(dir);
  await git(setup, ['init', '--quiet', '--initial-branch=main', 'demo']);

  const run = repoRunner(join(dir, 'demo'));
  await git(run, ['commit', '--quiet', '--allow-empty', '-m', 'init']);
  await git(run, [
    'worktree',
    'add',
    '--quiet',
    '-b',
    'feature/a',
    '../demo-feature-a',
  ]);
  await git(run, [
    'worktree',
    'add',
    '--quiet',
    '--detach',
    '../demo-detached',
  ]);
  await git(run, [
    'worktree',
    'lock',
    '../demo-feature-a',
    '--reason',
    'on the road',
  ]);

  const inventory = await readInventory(run);

  expect(inventory.layout.repo).toBe('demo');
  expect(inventory.main.branch).toBe('main');
  expect(
    inventory.entries.map((entry) => [entry.branch, entry.detached]),
  ).toEqual(
    expect.arrayContaining([
      ['main', false],
      ['feature/a', false],
      [null, true],
    ]),
  );
  const locked = inventory.entries.find((entry) => entry.locked !== null);
  expect(locked?.locked).toBe('on the road');
});

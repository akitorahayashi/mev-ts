import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import {
  bunCommandRunner,
  type CommandRunner,
} from '../../../src/host/command';
import { deleteBranches } from '../../../src/internal/git/branches';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const defaultBranch = { code: 0, stdout: 'origin/main\n', stderr: '' };
const ok = { code: 0, stdout: '', stderr: '' };

const listHeads = [
  'for-each-ref',
  '--format=%(refname:lstrip=2)',
  'refs/heads/',
];

function localBranches(names: readonly string[]) {
  return { code: 0, stdout: `${names.join('\n')}\n`, stderr: '' };
}

test('moves to the default branch, pulls, deletes, and prunes', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      localBranches(['main', 'feature/a', 'feature/b']),
      ok,
      ok,
      ok,
      ok,
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', 'feature/b']);

  expect(calls).toEqual([
    {
      command: 'git',
      args: ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
      stdout: undefined,
      stderr: undefined,
    },
    {
      command: 'git',
      args: listHeads,
      stdout: undefined,
      stderr: undefined,
    },
    {
      command: 'git',
      args: ['checkout', 'main'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    { command: 'git', args: ['pull'], stdout: 'inherit', stderr: 'inherit' },
    {
      command: 'git',
      args: ['branch', '-D', '--', 'feature/a', 'feature/b'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      command: 'git',
      args: ['remote', 'prune', 'origin'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('moves to the --to destination instead of the default branch', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      localBranches(['main', 'dev', 'feature/a']),
      ok,
      ok,
      ok,
      ok,
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', '--to', 'dev']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    listHeads,
    ['checkout', 'dev'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('accepts -t as the destination shorthand and deduplicates branches', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      localBranches(['main', 'dev', 'feature/a']),
      ok,
      ok,
      ok,
      ok,
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', '-t', 'dev', 'feature/a']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    listHeads,
    ['checkout', 'dev'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('rejects deleting the default branch', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([defaultBranch], calls);

  await expect(
    deleteBranches(run, ['feature/a', 'main']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
  ]);
});

test('rejects deleting the destination branch', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([defaultBranch], calls);

  await expect(
    deleteBranches(run, ['dev', 'feature/a', '--to', 'dev']),
  ).rejects.toThrow("Cannot delete the destination branch 'dev'.");
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
  ]);
});

test('rejects unknown local branches before any state changes', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [defaultBranch, localBranches(['main', 'feature/a'])],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a', 'typo'])).rejects.toThrow(
    'No such local branch: typo.',
  );
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    listHeads,
  ]);
});

test('errors when origin/HEAD is not set', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [{ code: 128, stdout: '', stderr: 'fatal: ambiguous argument' }],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('stops before delete when pull fails', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      localBranches(['main', 'feature/a']),
      ok,
      { code: 1, stdout: '', stderr: 'pull failed' },
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    listHeads,
    ['checkout', 'main'],
    ['pull'],
  ]);
});

test('rejects a dash-leading destination before running any command', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [defaultBranch, localBranches(['main', 'feature/a'])],
    calls,
  );

  await expect(
    deleteBranches(run, ['feature/a', '--to', '-weird']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls).toEqual([]);
});

test('reports inherited command failures without pretending output was captured', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      localBranches(['main', 'feature/a']),
      ok,
      { code: 1, stdout: '', stderr: '' },
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toThrow(
    'git pull failed with code 1: see command output above',
  );
});

/**
 * A runner pinned to `cwd` with git's global and system configuration
 * neutralized and an identity supplied, so the real-git case below cannot read
 * or depend on the developer's own git setup. Output is captured rather than
 * inherited to keep the test's own stdio clean.
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

async function refNames(
  run: CommandRunner,
  namespace: string,
): Promise<string[]> {
  const result = await run.run('git', [
    'for-each-ref',
    '--format=%(refname)',
    namespace,
  ]);
  return result.stdout.split('\n').filter((line) => line !== '');
}

const realGitTest = sandboxedTest('mev-branches-');

// Exercised against real git because the defect this covers lives in git's own
// refname formatting: the fake runner above cannot reproduce an abbreviation
// that only appears when two namespaces collide.
realGitTest('deletes a local branch whose name is also a tag', async (dir) => {
  const remote = join(dir, 'remote.git');
  const work = join(dir, 'work');
  const setup = repoRunner(dir);
  await git(setup, [
    'init',
    '--quiet',
    '--bare',
    '--initial-branch=main',
    remote,
  ]);
  await git(setup, ['clone', '--quiet', remote, work]);

  const run = repoRunner(work);
  await git(run, ['commit', '--quiet', '--allow-empty', '-m', 'init']);
  await git(run, ['push', '--quiet', 'origin', 'main']);
  await git(run, ['remote', 'set-head', 'origin', '--auto']);
  // The colliding tag is the whole point: with both refs present, git
  // abbreviates the branch as `heads/foo` rather than `foo`.
  await git(run, ['branch', 'foo']);
  await git(run, ['tag', 'foo']);

  await deleteBranches(run, ['foo']);

  expect(await refNames(run, 'refs/heads/')).toEqual(['refs/heads/main']);
  // Deleting the branch must leave the same-named tag untouched.
  expect(await refNames(run, 'refs/tags/')).toEqual(['refs/tags/foo']);
});

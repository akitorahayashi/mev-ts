import { expect, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import { deleteBranches } from '../../../src/internal/git/branches';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';

const defaultBranch = { code: 0, stdout: 'origin/main\n', stderr: '' };
const branchExists = { code: 0, stdout: 'abc123\n', stderr: '' };
const ok = { code: 0, stdout: '', stderr: '' };

test('moves to the default branch, pulls, deletes, and prunes', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      branchExists, // feature/a
      branchExists, // feature/b
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', 'feature/b']);

  expect(calls).toEqual([
    {
      args: ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
      stdout: undefined,
      stderr: undefined,
    },
    {
      args: ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/a'],
      stdout: undefined,
      stderr: undefined,
    },
    {
      args: ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/b'],
      stdout: undefined,
      stderr: undefined,
    },
    { args: ['checkout', '--', 'main'], stdout: 'inherit', stderr: 'inherit' },
    { args: ['pull'], stdout: 'inherit', stderr: 'inherit' },
    {
      args: ['branch', '-D', '--', 'feature/a', 'feature/b'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      args: ['remote', 'prune', 'origin'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('moves to the --to destination instead of the default branch', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([defaultBranch, branchExists], calls);

  await deleteBranches(run, ['feature/a', '--to', 'dev']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/a'],
    ['checkout', '--', 'dev'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('accepts -t as the destination shorthand and deduplicates branches', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([defaultBranch, branchExists], calls);

  await deleteBranches(run, ['feature/a', '-t', 'dev', 'feature/a']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/a'],
    ['checkout', '--', 'dev'],
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
    [
      defaultBranch,
      branchExists, // feature/a
      { code: 1, stdout: '', stderr: '' }, // typo — not a local branch
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a', 'typo'])).rejects.toThrow(
    'No such local branch: typo.',
  );
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/a'],
    ['rev-parse', '--verify', '--quiet', 'refs/heads/typo'],
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
      branchExists, // feature/a
      ok, // checkout
      { code: 1, stdout: '', stderr: 'pull failed' }, // pull
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/a'],
    ['checkout', '--', 'main'],
    ['pull'],
  ]);
});

test('guards a dash-leading destination behind -- so git cannot read it as a flag', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner([defaultBranch, branchExists], calls);

  await deleteBranches(run, ['feature/a', '--to', '-weird']);

  expect(calls.map((c) => c.args)).toContainEqual(['checkout', '--', '-weird']);
});

test('reports inherited command failures without pretending output was captured', async () => {
  const calls: RecordedCall[] = [];
  const run = sequenceRunner(
    [
      defaultBranch,
      branchExists, // feature/a
      ok, // checkout
      { code: 1, stdout: '', stderr: '' }, // pull
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toThrow(
    'git pull failed with code 1: see command output above',
  );
});

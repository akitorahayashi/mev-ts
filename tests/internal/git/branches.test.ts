import { expect, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { deleteBranches } from '../../../src/internal/git/branches';

interface Call {
  args: string[];
}

function sequenceRunner(
  responses: CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args): Promise<CommandResult> {
      calls.push({ args: [...args] });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

test('deletes branches and prunes without checkout when not on a deleted branch', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'main\n', stderr: '' }, // current
      { code: 0, stdout: 'origin/main\n', stderr: '' }, // default
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', 'feature/b']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['branch', '-D', '--', 'feature/a', 'feature/b'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('checks out default branch and pulls before deleting when on a deleted branch', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'feature/a\n', stderr: '' }, // current
      { code: 0, stdout: 'origin/main\n', stderr: '' }, // default
    ],
    calls,
  );

  await deleteBranches(run, ['feature/a', 'feature/b']);

  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['checkout', 'main'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a', 'feature/b'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('rejects an empty branch list', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(deleteBranches(run, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
  expect(calls).toHaveLength(0);
});

test('rejects deleting the default branch when current branch is not in the delete list', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'feature/b\n', stderr: '' }, // current — not in tokens
      { code: 0, stdout: 'origin/main\n', stderr: '' }, // default
    ],
    calls,
  );

  await expect(
    deleteBranches(run, ['feature/a', 'main']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects deleting the default branch when current branch is in the delete list', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'feature/a\n', stderr: '' }, // current — in tokens
      { code: 0, stdout: 'origin/main\n', stderr: '' }, // default
    ],
    calls,
  );

  await expect(
    deleteBranches(run, ['feature/a', 'main']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('errors when origin/HEAD is not set', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'feature/a\n', stderr: '' },
      { code: 128, stdout: '', stderr: 'fatal: ambiguous argument' },
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('stops before delete when pull fails', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: 'feature/a\n', stderr: '' }, // current
      { code: 0, stdout: 'origin/main\n', stderr: '' }, // default
      { code: 0, stdout: '', stderr: '' }, // checkout
      { code: 1, stdout: '', stderr: 'pull failed' }, // pull
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls.map((c) => c.args)).toEqual([
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    ['checkout', 'main'],
    ['pull'],
  ]);
});

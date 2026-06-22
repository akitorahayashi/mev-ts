import { expect, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/mev/errors';
import { deleteBranches } from '../../../src/mev/internal/git/branches';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/mev/resources/model';

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

test('updates main, deletes branches, and prunes origin', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await deleteBranches(run, ['feature/a', 'feature/b']);

  expect(calls.map((c) => c.args)).toEqual([
    ['checkout', 'main'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a', 'feature/b'],
    ['remote', 'prune', 'origin'],
  ]);
});

test('checks out the branch named after the separator', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await deleteBranches(run, ['feature/a', '--', 'develop']);

  expect(calls.map((c) => c.args)).toEqual([
    ['checkout', 'develop'],
    ['pull'],
    ['branch', '-D', '--', 'feature/a'],
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

test('rejects when no checkout branch follows the separator', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(deleteBranches(run, ['feature/a', '--'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
  expect(calls).toHaveLength(0);
});

test('rejects more than one checkout branch', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(
    deleteBranches(run, ['feature/a', '--', 'develop', 'extra']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls).toHaveLength(0);
});

test('rejects deleting the checkout branch', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(deleteBranches(run, ['main'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
  expect(calls).toHaveLength(0);
});

test('stops before delete when pull fails', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 1, stdout: '', stderr: 'pull failed' },
    ],
    calls,
  );

  await expect(deleteBranches(run, ['feature/a'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls.map((c) => c.args)).toEqual([['checkout', 'main'], ['pull']]);
});

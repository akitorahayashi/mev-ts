import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { cloneRepositories } from '../../../src/internal/git/clone';

let stdout: ReturnType<typeof spyOn>;

beforeEach(() => {
  stdout = spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdout.mockRestore();
});

interface Call {
  args: string[];
  stdout?: 'pipe' | 'inherit';
  stderr?: 'pipe' | 'inherit';
}

function sequenceRunner(
  responses: CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args, options): Promise<CommandResult> {
      calls.push({
        args: [...args],
        stdout: options?.stdout,
        stderr: options?.stderr,
      });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

test('clones each url in order', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB']);

  expect(calls).toEqual([
    { args: ['clone', 'urlA'], stdout: 'inherit', stderr: 'inherit' },
    { args: ['clone', 'urlB'], stdout: 'inherit', stderr: 'inherit' },
  ]);
});

test('applies flags after the separator to every clone', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB', '--', '--depth', '1']);

  expect(calls).toEqual([
    {
      args: ['clone', '--depth', '1', 'urlA'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      args: ['clone', '--depth', '1', 'urlB'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('stops at the first failure', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: 'boom' }], calls);

  await expect(cloneRepositories(run, ['urlA', 'urlB'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls).toHaveLength(1);
});

test('rejects an empty url list', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(cloneRepositories(run, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
  expect(calls).toHaveLength(0);
});

test('rejects when only flags are supplied', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await expect(
    cloneRepositories(run, ['--', '--depth', '1']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls).toHaveLength(0);
});

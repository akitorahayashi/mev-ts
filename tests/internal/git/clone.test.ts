import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { cloneRepositories } from '../../../src/internal/git/clone';

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

test('reports inherited clone failures without pretending output was captured', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: '' }], calls);

  await expect(cloneRepositories(run, ['urlA'])).rejects.toThrow(
    'git clone urlA failed with code 1: see command output above',
  );
});

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../../src/errors';
import { cloneRepositories } from '../../../src/internal/git/clone';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/resources/model';

let stdout: ReturnType<typeof spyOn>;

beforeEach(() => {
  stdout = spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdout.mockRestore();
});

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

test('clones each url in order', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB']);

  expect(calls).toEqual([
    { args: ['clone', 'urlA'] },
    { args: ['clone', 'urlB'] },
  ]);
});

test('applies flags after the separator to every clone', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB', '--', '--depth', '1']);

  expect(calls).toEqual([
    { args: ['clone', '--depth', '1', 'urlA'] },
    { args: ['clone', '--depth', '1', 'urlB'] },
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

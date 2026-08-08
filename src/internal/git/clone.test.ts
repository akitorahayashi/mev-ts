import { expect, test } from 'bun:test';
import { CommandLineError, ProvisioningError } from '../../errors';
import type {
  CommandOptions,
  CommandResult,
  CommandRunner,
} from '../../host/command';
import { cloneRepositories } from './clone';

interface CloneCall {
  readonly command: string;
  readonly args: string[];
  readonly stdout?: CommandOptions['stdout'];
  readonly stderr?: CommandOptions['stderr'];
}

function cloneRunner(
  responses: readonly CommandResult[],
  calls: CloneCall[],
): CommandRunner {
  let index = 0;
  return {
    async run(command, args, options): Promise<CommandResult> {
      calls.push({
        command,
        args: [...args],
        stdout: options?.stdout,
        stderr: options?.stderr,
      });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

test('rejects an empty url list', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };

  await expect(cloneRepositories(dummyRunner, [])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects when only flags are supplied', async () => {
  const dummyRunner: CommandRunner = {
    async run() {
      throw new Error('CommandRunner should not be called');
    },
  };

  await expect(
    cloneRepositories(dummyRunner, ['--', '--depth', '1']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('clones each url through grove in order', async () => {
  const calls: CloneCall[] = [];
  const run = cloneRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB']);

  expect(calls).toEqual([
    {
      command: 'gv',
      args: ['clone', '--', 'urlA'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      command: 'gv',
      args: ['clone', '--', 'urlB'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('applies git clone flags after the separator to every url', async () => {
  const calls: CloneCall[] = [];
  const run = cloneRunner([], calls);

  await cloneRepositories(run, ['urlA', 'urlB', '--', '--depth', '1']);

  expect(calls).toEqual([
    {
      command: 'gv',
      args: ['clone', '--depth', '1', '--', 'urlA'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      command: 'gv',
      args: ['clone', '--depth', '1', '--', 'urlB'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
  ]);
});

test('rejects a repository URL that could be read as a git flag', async () => {
  const calls: CloneCall[] = [];
  const run = cloneRunner([], calls);

  await expect(
    cloneRepositories(run, ['--upload-pack=evil']),
  ).rejects.toBeInstanceOf(CommandLineError);
  expect(calls).toHaveLength(0);
});

test('stops at the first failure', async () => {
  const calls: CloneCall[] = [];
  const run = cloneRunner([{ code: 1, stdout: '', stderr: 'boom' }], calls);

  await expect(cloneRepositories(run, ['urlA', 'urlB'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
  expect(calls).toHaveLength(1);
});

test('reports inherited clone failures without pretending output was captured', async () => {
  const calls: CloneCall[] = [];
  const run = cloneRunner([{ code: 1, stdout: '', stderr: '' }], calls);

  await expect(cloneRepositories(run, ['urlA'])).rejects.toThrow(
    'gv clone urlA failed with code 1: see command output above',
  );
});

test('redacts clone URL credentials from progress and failure output', async () => {
  const calls: CloneCall[] = [];
  const messages: string[] = [];
  const run = cloneRunner([{ code: 1, stdout: '', stderr: '' }], calls);
  const url = 'https://user:secret@example.com/owner/repo.git';

  await expect(
    cloneRepositories(run, [url], (message) => messages.push(message)),
  ).rejects.toThrow(
    'gv clone https://REDACTED@example.com/owner/repo.git failed with code 1: see command output above',
  );

  expect(messages).toEqual([
    'Cloning https://REDACTED@example.com/owner/repo.git...\n',
  ]);
  expect(calls[0]).toMatchObject({
    command: 'gv',
    args: ['clone', '--', url],
  });
});

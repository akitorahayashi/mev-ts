import { expect, test } from 'bun:test';
import { authStatus } from '../../../src/internal/gh/auth';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/resources/model';

function runner(
  preset: CommandResult,
  sink: { command?: string; args?: string[] } = {},
): CommandRunner {
  return {
    async run(command, args): Promise<CommandResult> {
      sink.command = command;
      sink.args = [...args];
      return preset;
    },
  };
}

test('authStatus returns true when gh auth status succeeds', async () => {
  const run = runner({ code: 0, stdout: '', stderr: '' });
  expect(await authStatus(run)).toBe(true);
});

test('authStatus returns false when not authenticated', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'not logged in' });
  expect(await authStatus(run)).toBe(false);
});

test('authStatus passes correct argv', async () => {
  const sink: { command?: string; args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await authStatus(run);
  expect(sink.command).toBe('gh');
  expect(sink.args).toEqual(['auth', 'status']);
});

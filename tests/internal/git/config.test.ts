import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { configGet, configSetGlobal } from '../../../src/internal/git/config';

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

test('configGet returns trimmed value on exit 0', async () => {
  const run = runner({
    code: 0,
    stdout: '/home/test/.gitignore_global\n',
    stderr: '',
  });
  expect(await configGet(run, 'core.excludesfile')).toBe(
    '/home/test/.gitignore_global',
  );
});

test('configGet returns null on non-zero exit', async () => {
  const run = runner({ code: 1, stdout: '', stderr: '' });
  expect(await configGet(run, 'core.excludesfile')).toBeNull();
});

test('configGet passes correct argv', async () => {
  const sink: { command?: string; args?: string[] } = {};
  const run = runner({ code: 0, stdout: 'value\n', stderr: '' }, sink);
  await configGet(run, 'core.excludesfile');
  expect(sink.command).toBe('git');
  expect(sink.args).toEqual([
    'config',
    '--global',
    '--get',
    'core.excludesfile',
  ]);
});

test('configSetGlobal passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await configSetGlobal(run, 'user.name', 'Example');
  expect(sink.args).toEqual(['config', '--global', 'user.name', 'Example']);
});

test('configSetGlobal throws ProvisioningError on non-zero exit', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'error' });
  await expect(
    configSetGlobal(run, 'user.name', 'Example'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

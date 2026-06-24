import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { get } from '../../../src/internal/gh/api';

function runner(
  preset: CommandResult,
  sink: { args?: string[] } = {},
): CommandRunner {
  return {
    async run(_command, args): Promise<CommandResult> {
      sink.args = [...args];
      return preset;
    },
  };
}

test('get parses JSON response', async () => {
  const run = runner({
    code: 0,
    stdout: '{"login":"user","id":1}',
    stderr: '',
  });
  const result = await get<{ login: string; id: number }>(run, '/user');
  expect(result.login).toBe('user');
  expect(result.id).toBe(1);
});

test('get passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '{}', stderr: '' }, sink);
  await get(run, '/repos/owner/repo');
  expect(sink.args).toEqual(['api', '/repos/owner/repo']);
});

test('get throws ProvisioningError on non-zero exit', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'Not Found' });
  await expect(get(run, '/repos/owner/repo')).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

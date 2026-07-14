import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import { configGet, configSetGlobal } from '../../../src/internal/git/config';
import { presetRunner } from '../../fixtures/fake-command-runner';

test('configGet returns trimmed value on exit 0', async () => {
  const run = presetRunner({
    code: 0,
    stdout: '/home/test/.gitignore_global\n',
    stderr: '',
  });
  expect(await configGet(run, 'core.excludesfile')).toBe(
    '/home/test/.gitignore_global',
  );
});

test('configGet returns null on exit 1 (unset key)', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: '' });
  expect(await configGet(run, 'core.excludesfile')).toBeNull();
});

test('configGet throws on an unexpected exit such as code 127', async () => {
  const run = presetRunner({ code: 127, stdout: '', stderr: 'git: not found' });
  await expect(configGet(run, 'core.excludesfile')).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('configGet passes correct argv', async () => {
  const sink: { command?: string; args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: 'value\n', stderr: '' }, sink);
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
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await configSetGlobal(run, 'user.name', 'Example');
  expect(sink.args).toEqual(['config', '--global', 'user.name', 'Example']);
});

test('configSetGlobal throws ProvisioningError on non-zero exit', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(
    configSetGlobal(run, 'user.name', 'Example'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

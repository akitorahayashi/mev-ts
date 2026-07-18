import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import {
  configGet,
  configGetFile,
  configSetFile,
} from '../../../src/internal/git/config';
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

test('configGetFile passes the explicit path', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: 'Example\n', stderr: '' }, sink);
  await configGetFile(run, '/home/test/.gitconfig', 'user.name');
  expect(sink.args).toEqual([
    'config',
    '--file',
    '/home/test/.gitconfig',
    '--get',
    'user.name',
  ]);
});

test('configGetFile returns null on exit 1', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: '' });
  expect(
    await configGetFile(run, '/home/test/.gitconfig', 'user.name'),
  ).toBeNull();
});

test('configSetFile passes the explicit path', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  await configSetFile(run, '/home/test/.gitconfig', 'user.name', 'Example');
  expect(sink.args).toEqual([
    'config',
    '--file',
    '/home/test/.gitconfig',
    'user.name',
    'Example',
  ]);
});

test('configSetFile throws ProvisioningError on non-zero exit', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: 'error' });
  await expect(
    configSetFile(run, '/home/test/.gitconfig', 'user.name', 'Example'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

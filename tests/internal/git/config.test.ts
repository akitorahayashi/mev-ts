import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { AppError } from '../../../src/errors';
import {
  configGet,
  configGetFile,
  configSetFile,
  configSetFileValues,
} from '../../../src/git/config';
import { presetRunner } from '../../fixtures/fake-command-runner';
import { withTemporaryDirectory } from '../../fixtures/temporary-directory';

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
    AppError,
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
  ).rejects.toBeInstanceOf(AppError);
});

test('configSetFileValues applies values to one staging file', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const calls: string[][] = [];
      const run = {
        async run(_command: string, args: readonly string[]) {
          calls.push([...args]);
          return { code: 0, stdout: '', stderr: '' };
        },
      };

      await configSetFileValues(run, join(dir, '.gitconfig'), [
        ['user.name', 'Example'],
        ['user.email', 'example@example.com'],
      ]);

      expect(calls).toHaveLength(2);
      const first = calls[0];
      const second = calls[1];
      if (!first || !second) throw new Error('expected two config writes');
      const stage = first[2];
      if (!stage) throw new Error('expected staged git config path');
      expect(first.slice(0, 3)).toEqual(['config', '--file', stage]);
      expect(second[2]).toBe(stage);
      expect(calls.map((args) => args.slice(3))).toEqual([
        ['user.name', 'Example'],
        ['user.email', 'example@example.com'],
      ]);
    },
    { prefix: 'git-config-' },
  );
});

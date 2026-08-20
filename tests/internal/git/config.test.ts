import { expect, test } from 'bun:test';
import { lstat, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../../src/errors';
import {
  configGet,
  configGetFile,
  configGetLocal,
  configSetFileValues,
  configSetLocalValues,
  configUnsetLocal,
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

test('configGetLocal targets the repository at cwd', async () => {
  const sink: { command?: string; args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: 'Example\n', stderr: '' }, sink);
  expect(await configGetLocal(run, '/repos/project', 'user.name')).toBe(
    'Example',
  );
  expect(sink.command).toBe('git');
  expect(sink.args).toEqual([
    '-C',
    '/repos/project',
    'config',
    '--local',
    '--get',
    'user.name',
  ]);
});

test('configGetLocal returns null on exit 1', async () => {
  const run = presetRunner({ code: 1, stdout: '', stderr: '' });
  expect(await configGetLocal(run, '/repos/project', 'user.name')).toBeNull();
});

test('configGetLocal throws on exit 128', async () => {
  const run = presetRunner({
    code: 128,
    stdout: '',
    stderr: 'fatal: --local can only be used inside a git repository',
  });
  await expect(
    configGetLocal(run, '/repos/project', 'user.name'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('configSetLocalValues writes each pair through --local at cwd', async () => {
  const calls: string[][] = [];
  const run = {
    async run(_command: string, args: readonly string[]) {
      calls.push([...args]);
      return { code: 0, stdout: '', stderr: '' };
    },
  };

  await configSetLocalValues(run, '/repos/project', [
    ['user.name', 'Example'],
    ['user.email', 'example@example.com'],
  ]);

  expect(calls).toEqual([
    [
      '-C',
      '/repos/project',
      'config',
      '--local',
      '--replace-all',
      'user.name',
      'Example',
    ],
    [
      '-C',
      '/repos/project',
      'config',
      '--local',
      '--replace-all',
      'user.email',
      'example@example.com',
    ],
  ]);
});

test('configSetLocalValues throws on a non-zero exit', async () => {
  const run = presetRunner({ code: 128, stdout: '', stderr: 'fatal' });
  await expect(
    configSetLocalValues(run, '/repos/project', [['user.name', 'Example']]),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('configUnsetLocal reports removal on exit 0', async () => {
  const sink: { args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '', stderr: '' }, sink);
  expect(await configUnsetLocal(run, '/repos/project', 'user.name')).toBe(true);
  expect(sink.args).toEqual([
    '-C',
    '/repos/project',
    'config',
    '--local',
    '--unset-all',
    'user.name',
  ]);
});

test('configUnsetLocal reports an absent key on exit 5', async () => {
  const run = presetRunner({ code: 5, stdout: '', stderr: '' });
  expect(await configUnsetLocal(run, '/repos/project', 'user.name')).toBe(
    false,
  );
});

test('configUnsetLocal throws on other exits', async () => {
  const run = presetRunner({ code: 128, stdout: '', stderr: 'fatal' });
  await expect(
    configUnsetLocal(run, '/repos/project', 'user.name'),
  ).rejects.toBeInstanceOf(ProvisioningError);
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

test('configSetFileValues preserves a dangling config symlink', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const link = join(dir, '.gitconfig');
      const target = join(dir, 'identity', 'gitconfig');
      await symlink('identity/gitconfig', link);
      const run = presetRunner({ code: 0, stdout: '', stderr: '' });

      await configSetFileValues(run, link, [['user.name', 'Example']]);

      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await readFile(target, 'utf8')).toBe('');
    },
    { prefix: 'git-config-dangling-symlink-' },
  );
});

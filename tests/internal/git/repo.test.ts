import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/errors';
import { isInsideGitRepository } from '../../../src/git/repo';
import { presetRunner } from '../../fixtures/fake-command-runner';

test('isInsideGitRepository detects a repository on exit 0', async () => {
  const sink: { command?: string; args?: string[] } = {};
  const run = presetRunner({ code: 0, stdout: '.git\n', stderr: '' }, sink);
  expect(await isInsideGitRepository(run, '/repos/project')).toBe(true);
  expect(sink.command).toBe('git');
  expect(sink.args).toEqual(['-C', '/repos/project', 'rev-parse', '--git-dir']);
});

test('isInsideGitRepository maps the not-a-repository fatal to false', async () => {
  const run = presetRunner({
    code: 128,
    stdout: '',
    stderr:
      'fatal: not a git repository (or any of the parent directories): .git\n',
  });
  expect(await isInsideGitRepository(run, '/tmp/elsewhere')).toBe(false);
});

test('isInsideGitRepository throws when git is missing', async () => {
  const run = presetRunner({ code: 127, stdout: '', stderr: 'git: not found' });
  await expect(
    isInsideGitRepository(run, '/repos/project'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('isInsideGitRepository throws on other 128 fatals', async () => {
  const run = presetRunner({
    code: 128,
    stdout: '',
    stderr: 'fatal: detected dubious ownership in repository\n',
  });
  await expect(
    isInsideGitRepository(run, '/repos/project'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

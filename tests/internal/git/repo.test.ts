import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/mev/errors';
import {
  clone,
  defaultBranch,
  deleteMergedBranches,
  fetch,
  isRepo,
  remoteGetUrl,
} from '../../../src/mev/internal/git/repo';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/mev/resources/model';

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

test('isRepo returns true when rev-parse succeeds', async () => {
  const run = runner({ code: 0, stdout: 'true\n', stderr: '' });
  expect(await isRepo(run, '/repo')).toBe(true);
});

test('isRepo returns false on non-zero exit', async () => {
  const run = runner({ code: 128, stdout: '', stderr: '' });
  expect(await isRepo(run, '/repo')).toBe(false);
});

test('isRepo passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: 'true\n', stderr: '' }, sink);
  await isRepo(run, '/repo');
  expect(sink.args).toEqual([
    '-C',
    '/repo',
    'rev-parse',
    '--is-inside-work-tree',
  ]);
});

test('clone passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await clone(run, 'https://github.com/user/repo.git', '/dest');
  expect(sink.args).toEqual([
    'clone',
    'https://github.com/user/repo.git',
    '/dest',
  ]);
});

test('clone throws ProvisioningError on failure', async () => {
  const run = runner({
    code: 128,
    stdout: '',
    stderr: 'fatal: repository not found',
  });
  await expect(
    clone(run, 'https://github.com/user/repo.git', '/dest'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('fetch passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await fetch(run, '/repo');
  expect(sink.args).toEqual(['-C', '/repo', 'fetch']);
});

test('fetch throws ProvisioningError on failure', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'error' });
  await expect(fetch(run, '/repo')).rejects.toBeInstanceOf(ProvisioningError);
});

test('remoteGetUrl returns trimmed url on success', async () => {
  const run = runner({
    code: 0,
    stdout: 'https://github.com/user/repo.git\n',
    stderr: '',
  });
  expect(await remoteGetUrl(run, '/repo', 'origin')).toBe(
    'https://github.com/user/repo.git',
  );
});

test('remoteGetUrl returns null when remote does not exist', async () => {
  const run = runner({ code: 2, stdout: '', stderr: '' });
  expect(await remoteGetUrl(run, '/repo', 'origin')).toBeNull();
});

test('remoteGetUrl passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: 'url\n', stderr: '' }, sink);
  await remoteGetUrl(run, '/repo', 'origin');
  expect(sink.args).toEqual(['-C', '/repo', 'remote', 'get-url', 'origin']);
});

test('defaultBranch returns branch name stripped of origin/ prefix', async () => {
  const run = runner({ code: 0, stdout: 'origin/main\n', stderr: '' });
  expect(await defaultBranch(run, '/repo')).toBe('main');
});

test('defaultBranch passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: 'origin/main\n', stderr: '' }, sink);
  await defaultBranch(run, '/repo');
  expect(sink.args).toEqual([
    '-C',
    '/repo',
    'rev-parse',
    '--abbrev-ref',
    'origin/HEAD',
  ]);
});

test('defaultBranch throws ProvisioningError when origin/HEAD is not set', async () => {
  const run = runner({
    code: 128,
    stdout: '',
    stderr: 'fatal: ambiguous argument',
  });
  await expect(defaultBranch(run, '/repo')).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('defaultBranch throws ProvisioningError on unexpected ref format', async () => {
  const run = runner({ code: 0, stdout: 'HEAD\n', stderr: '' });
  await expect(defaultBranch(run, '/repo')).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

function multiRunner(
  responses: CommandResult[],
  sink: { calls?: string[][] } = {},
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args): Promise<CommandResult> {
      sink.calls ??= [];
      sink.calls.push([...args]);
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

test('deleteMergedBranches deletes merged branches excluding base and current', async () => {
  const run = multiRunner([
    { code: 0, stdout: 'feature-a\nfeature-b\nmain\n', stderr: '' },
    { code: 0, stdout: 'develop\n', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
  ]);
  const deleted = await deleteMergedBranches(run, '/repo', 'main');
  expect(deleted).toEqual(['feature-a', 'feature-b']);
});

test('deleteMergedBranches excludes current branch', async () => {
  const run = multiRunner([
    { code: 0, stdout: 'feature-a\nfeature-b\n', stderr: '' },
    { code: 0, stdout: 'feature-a\n', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
  ]);
  const deleted = await deleteMergedBranches(run, '/repo', 'main');
  expect(deleted).toEqual(['feature-b']);
});

test('deleteMergedBranches returns empty array when no candidates', async () => {
  const run = multiRunner([
    { code: 0, stdout: 'main\n', stderr: '' },
    { code: 0, stdout: 'main\n', stderr: '' },
  ]);
  const deleted = await deleteMergedBranches(run, '/repo', 'main');
  expect(deleted).toEqual([]);
});

test('deleteMergedBranches throws ProvisioningError when branch list fails', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'error' });
  await expect(
    deleteMergedBranches(run, '/repo', 'main'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

test('deleteMergedBranches throws ProvisioningError when branch delete fails', async () => {
  const run = multiRunner([
    { code: 0, stdout: 'feature-a\n', stderr: '' },
    { code: 0, stdout: 'other\n', stderr: '' },
    { code: 1, stdout: '', stderr: 'error: not fully merged' },
  ]);
  await expect(
    deleteMergedBranches(run, '/repo', 'main'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

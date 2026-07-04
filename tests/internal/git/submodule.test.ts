import { expect, test } from 'bun:test';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../../src/errors';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { deleteSubmodule } from '../../../src/internal/git/submodule';
import { withTemporaryDirectory } from '../../fixtures/temporary-directory';

interface Call {
  args: string[];
  stdout?: 'pipe' | 'inherit';
  stderr?: 'pipe' | 'inherit';
}

function sequenceRunner(
  responses: CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args, options): Promise<CommandResult> {
      calls.push({
        args: [...args],
        stdout: options?.stdout,
        stderr: options?.stderr,
      });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

let sandbox: string;

function sandboxTest(name: string, body: () => Promise<void>): void {
  test(name, async () => {
    await withTemporaryDirectory(
      async (dir) => {
        sandbox = dir;
        await body();
      },
      { prefix: 'submodule-' },
    );
  });
}

sandboxTest('runs deinit, rm, and config removal in order', async () => {
  const calls: Call[] = [];
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: sandbox, stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ],
    calls,
  );

  await deleteSubmodule(run, ['vendor/dep']);

  expect(calls).toEqual([
    {
      args: ['submodule', 'deinit', '-f', 'vendor/dep'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      args: ['rm', '-f', '-r', 'vendor/dep'],
      stdout: 'inherit',
      stderr: 'inherit',
    },
    {
      args: ['rev-parse', '--git-dir'],
      stdout: undefined,
      stderr: undefined,
    },
    {
      args: ['config', '--remove-section', 'submodule.vendor/dep'],
      stdout: undefined,
      stderr: undefined,
    },
  ]);
});

sandboxTest(
  'removes the .git/modules directory for the submodule',
  async () => {
    const modulesPath = join(sandbox, 'modules', 'vendor/dep');
    await mkdir(modulesPath, { recursive: true });

    const run = sequenceRunner(
      [
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: sandbox, stderr: '' },
        { code: 0, stdout: '', stderr: '' },
      ],
      [],
    );

    await deleteSubmodule(run, ['vendor/dep']);

    const exists = await stat(modulesPath).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);
  },
);

sandboxTest('tolerates a missing config section', async () => {
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: sandbox, stderr: '' },
      { code: 1, stdout: '', stderr: 'fatal: No such section!' },
    ],
    [],
  );

  await expect(deleteSubmodule(run, ['vendor/dep'])).resolves.toBeUndefined();
});

sandboxTest('throws when config removal fails for another reason', async () => {
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: sandbox, stderr: '' },
      { code: 1, stdout: '', stderr: 'fatal: something else' },
    ],
    [],
  );

  await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

sandboxTest('throws when deinit fails', async () => {
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: 'boom' }], []);

  await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

sandboxTest(
  'reports inherited submodule failures without pretending output was captured',
  async () => {
    const run = sequenceRunner([{ code: 1, stdout: '', stderr: '' }], []);

    await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toThrow(
      'git submodule deinit -f vendor/dep failed with code 1: see command output above',
    );
  },
);

sandboxTest('accepts a valid relative path', async () => {
  const run = sequenceRunner(
    [
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: sandbox, stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ],
    [],
  );
  await expect(deleteSubmodule(run, ['vendor/dep'])).resolves.toBeUndefined();
});

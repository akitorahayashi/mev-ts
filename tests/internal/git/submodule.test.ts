import { expect } from 'bun:test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../../src/errors';
import type { CommandRunner } from '../../../src/host/command';
import { deleteSubmodule } from '../../../src/internal/git/submodule';
import {
  type RecordedCall,
  sequenceRunner,
} from '../../fixtures/fake-command-runner';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('submodule-');

sandboxTest('runs deinit, rm, and config removal in order', async (sandbox) => {
  const calls: RecordedCall[] = [];
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
  async (sandbox) => {
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

sandboxTest('tolerates a missing config section', async (sandbox) => {
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

sandboxTest(
  'throws when config removal fails for another reason',
  async (sandbox) => {
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
  },
);

sandboxTest(
  'throws when probing the module directory fails for a non-ENOENT reason',
  async (sandbox) => {
    await writeFile(join(sandbox, 'modules'), 'not a directory');
    const calls: RecordedCall[] = [];
    const run = sequenceRunner(
      [
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: sandbox, stderr: '' },
        { code: 0, stdout: '', stderr: '' },
      ],
      calls,
    );

    await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toThrow();
    expect(calls.map(({ args }) => args)).toEqual([
      ['submodule', 'deinit', '-f', 'vendor/dep'],
      ['rm', '-f', '-r', 'vendor/dep'],
      ['rev-parse', '--git-dir'],
    ]);
  },
);

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

sandboxTest('accepts a valid relative path', async (sandbox) => {
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

sandboxTest(
  'pins LC_ALL=C for the parsed config-section removal',
  async (sandbox) => {
    let configEnv: Readonly<Record<string, string>> | undefined;
    const run: CommandRunner = {
      async run(_command, args, options) {
        if (args[0] === 'rev-parse') {
          return { code: 0, stdout: sandbox, stderr: '' };
        }
        if (args[0] === 'config') {
          configEnv = options?.env;
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    await deleteSubmodule(run, ['vendor/dep']);

    expect(configEnv).toEqual({ LC_ALL: 'C' });
  },
);

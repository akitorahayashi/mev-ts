import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../../src/mev/errors';
import { deleteSubmodule } from '../../../src/mev/internal/git/submodule';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/mev/resources/model';

interface Call {
  args: string[];
}

function sequenceRunner(
  responses: CommandResult[],
  calls: Call[],
): CommandRunner {
  let index = 0;
  return {
    async run(_command, args): Promise<CommandResult> {
      calls.push({ args: [...args] });
      return responses[index++] ?? { code: 0, stdout: '', stderr: '' };
    },
  };
}

let counter = 0;
let sandbox: string;
let stdout: ReturnType<typeof spyOn>;

beforeEach(async () => {
  stdout = spyOn(process.stdout, 'write').mockReturnValue(true);
  counter += 1;
  sandbox = join(process.cwd(), '.tmp', `submodule-${process.pid}-${counter}`);
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  stdout.mockRestore();
  await rm(sandbox, { force: true, recursive: true });
});

test('runs deinit, rm, and config removal in order', async () => {
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

  expect(calls.map((c) => c.args)).toEqual([
    ['submodule', 'deinit', '-f', 'vendor/dep'],
    ['rm', '-f', '-r', 'vendor/dep'],
    ['rev-parse', '--git-dir'],
    ['config', '--remove-section', 'submodule.vendor/dep'],
  ]);
});

test('removes the .git/modules directory for the submodule', async () => {
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
});

test('tolerates a missing config section', async () => {
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

test('throws when config removal fails for another reason', async () => {
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

test('throws when deinit fails', async () => {
  const run = sequenceRunner([{ code: 1, stdout: '', stderr: 'boom' }], []);

  await expect(deleteSubmodule(run, ['vendor/dep'])).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

test('rejects an absolute path', async () => {
  const run = sequenceRunner([], []);
  await expect(deleteSubmodule(run, ['/abs/path'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects parent traversal', async () => {
  const run = sequenceRunner([], []);
  await expect(deleteSubmodule(run, ['../escape'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects parent traversal hidden inside the path', async () => {
  const run = sequenceRunner([], []);
  await expect(
    deleteSubmodule(run, ['vendor/../escape']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects backslash-separated traversal', async () => {
  const run = sequenceRunner([], []);
  await expect(
    deleteSubmodule(run, ['vendor\\..\\escape']),
  ).rejects.toBeInstanceOf(CommandLineError);
});

test('rejects a current-directory segment', async () => {
  const run = sequenceRunner([], []);
  await expect(deleteSubmodule(run, ['./vendor/dep'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects an empty path', async () => {
  const run = sequenceRunner([], []);
  await expect(deleteSubmodule(run, [''])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('rejects more than one path', async () => {
  const run = sequenceRunner([], []);
  await expect(deleteSubmodule(run, ['a', 'b'])).rejects.toBeInstanceOf(
    CommandLineError,
  );
});

test('accepts a valid relative path', async () => {
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

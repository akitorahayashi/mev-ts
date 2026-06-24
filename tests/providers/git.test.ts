import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../src/errors';
import { git } from '../../src/providers/git';
import type { CommandResult, Context } from '../../src/resources/model';
import { home } from '../../src/resources/path';

interface RunnerScript {
  readonly code: number;
  readonly stdout?: string;
}

function contextWith(
  script: RunnerScript,
  sink: { args?: string[] } = {},
): Context {
  return {
    home: '/home/test',
    overwrite: false,
    commands: {
      async run(_command, args): Promise<CommandResult> {
        sink.args = [...args];
        return { code: script.code, stdout: script.stdout ?? '', stderr: '' };
      },
    },
    assets: {
      async read() {
        return '';
      },
    },
  };
}

const resource = git.config('core.excludesfile', home('.gitignore_global'));

test('inspect reports present when the configured value matches', async () => {
  const context = contextWith({
    code: 0,
    stdout: '/home/test/.gitignore_global\n',
  });
  expect((await resource.inspect(context)).kind).toBe('present');
});

test('inspect reports diverged when the configured value differs', async () => {
  const context = contextWith({ code: 0, stdout: '/elsewhere\n' });
  expect((await resource.inspect(context)).kind).toBe('diverged');
});

test('inspect reports missing when the value is unset', async () => {
  const context = contextWith({ code: 1 });
  expect((await resource.inspect(context)).kind).toBe('missing');
});

test('apply writes to ~/.gitconfig rather than following the global symlink', async () => {
  const sink: { args?: string[] } = {};
  const context = contextWith({ code: 0 }, sink);
  await resource.apply(context);
  expect(sink.args).toEqual([
    'config',
    '--file',
    '/home/test/.gitconfig',
    'core.excludesfile',
    '/home/test/.gitignore_global',
  ]);
});

test('apply fails when git config returns an error', async () => {
  const context = contextWith({ code: 1 });
  await expect(resource.apply(context)).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { ProvisioningError } from '../../src/errors';
import { brew } from '../../src/providers/brew';
import type { CommandResult, Context } from '../../src/resources/model';

interface RunnerScript {
  readonly code: number;
  readonly stdout?: string;
}

function contextWith(
  script: RunnerScript,
  sink: { brewfile?: string; args?: string[] },
): Context {
  return {
    home: '/sandbox',
    overwrite: false,
    commands: {
      async run(_command, args): Promise<CommandResult> {
        sink.args = [...args];
        const fileArg = args.find((arg) => arg.startsWith('--file='));
        if (fileArg) {
          sink.brewfile = await readFile(
            fileArg.slice('--file='.length),
            'utf8',
          );
        }
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

test('inspect reports present when brew bundle check succeeds', async () => {
  const sink: { brewfile?: string; args?: string[] } = {};
  const context = contextWith({ code: 0 }, sink);

  const state = await brew.formula('git').inspect(context);

  expect(state.kind).toBe('present');
  expect(sink.args?.slice(0, 2)).toEqual(['bundle', 'check']);
  expect(sink.brewfile).toBe('brew "git"\n');
});

test('inspect reports missing when brew bundle check fails', async () => {
  const context = contextWith({ code: 1 }, {});
  const state = await brew.formula('git').inspect(context);
  expect(state.kind).toBe('missing');
});

test('apply installs with --no-upgrade', async () => {
  const sink: { brewfile?: string; args?: string[] } = {};
  const context = contextWith({ code: 0 }, sink);

  await brew.formula('git').apply(context);

  expect(sink.args).toEqual([
    'bundle',
    'install',
    '--no-upgrade',
    expect.stringMatching(/^--file=/),
  ]);
});

test('apply fails when brew bundle install fails', async () => {
  const context = contextWith({ code: 1 }, {});
  await expect(brew.formula('git').apply(context)).rejects.toBeInstanceOf(
    ProvisioningError,
  );
});

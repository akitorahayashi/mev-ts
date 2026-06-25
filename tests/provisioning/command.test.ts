import { expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetSource } from '../../src/assets/registry';
import type { CommandOptions, CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { runActivation, runCommand } from '../../src/provisioning/activation';

interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: CommandOptions;
}

function contextWith(
  home: string,
  responder: (inv: Invocation) => CommandResult,
): { context: Context; calls: Invocation[] } {
  const calls: Invocation[] = [];
  const assets: AssetSource = {
    async read(key) {
      if (key === 'ruby/global/.ruby-version') return '3.3.3\n';
      throw new Error(`unexpected asset ${key}`);
    },
    keysByPrefix() {
      return [];
    },
  };
  const context: Context = {
    home,
    overwrite: false,
    assets,
    commands: {
      async run(command, args, options) {
        const inv = { command, args, options };
        calls.push(inv);
        return responder(inv);
      },
    },
  };
  return { context, calls };
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

test('reads inject asset values and captures feed later steps', async () => {
  const { context, calls } = contextWith('/home/u', (inv) =>
    inv.args.includes('--prefix') ? ok('/opt/homebrew\n') : ok(),
  );
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/global/.ruby-version' },
    steps: [
      {
        argv: () => ['brew', '--prefix'],
        capture: 'prefix',
        changedWhen: 'never',
      },
      { argv: (s) => ['install', s.ref('version'), s.ref('prefix')] },
    ],
  });

  const report = await runActivation(activation, context, false);

  expect(report.status).toBe('changed');
  expect(calls[1]?.args).toEqual(['3.3.3', '/opt/homebrew']);
});

test('skipIf with a satisfied pathExists guard marks the step unchanged', async () => {
  const sandbox = join(process.cwd(), '.tmp', `cmd-${process.pid}`);
  await mkdir(sandbox, { recursive: true });
  try {
    const { context, calls } = contextWith(sandbox, () => ok());
    const activation = runCommand({
      label: 'demo',
      steps: [
        {
          label: 'install',
          argv: () => ['install'],
          skipIf: () => ({ pathExists: sandbox }),
        },
      ],
    });

    const report = await runActivation(activation, context, false);

    expect(calls).toHaveLength(0);
    expect(report.entries?.[0]?.status).toBe('unchanged');
    expect(report.status).toBe('unchanged');
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
});

test('a non-zero step fails the activation and halts the pipeline', async () => {
  const { context, calls } = contextWith('/home/u', (inv) =>
    inv.command === 'boom' ? { code: 1, stdout: '', stderr: 'nope' } : ok(),
  );
  const activation = runCommand({
    label: 'demo',
    steps: [
      { label: 'boom', argv: () => ['boom'] },
      { label: 'after', argv: () => ['after'] },
    ],
  });

  const report = await runActivation(activation, context, false);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toBe('nope');
  expect(calls.map((c) => c.command)).toEqual(['boom']);
});

test('env thunk output reaches the command runner', async () => {
  const { calls, context } = contextWith('/home/u', () => ok());
  const activation = runCommand({
    label: 'demo',
    steps: [{ argv: () => ['x'], env: () => ({ FOO: 'bar' }) }],
  });

  await runActivation(activation, context, false);

  expect(calls[0]?.options?.env).toEqual({ FOO: 'bar' });
});

test('plan mode reports changed without running any step', async () => {
  const { calls, context } = contextWith('/home/u', () => ok());
  const activation = runCommand({
    label: 'demo',
    steps: [{ argv: () => ['x'] }],
  });

  const report = await runActivation(activation, context, true);

  expect(report.status).toBe('changed');
  expect(calls).toHaveLength(0);
});

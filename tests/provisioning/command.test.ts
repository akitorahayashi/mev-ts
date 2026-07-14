import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AssetSource } from '../../src/assets/registry';
import type { CommandResult } from '../../src/host/command';
import { runActivation, runCommand } from '../../src/provisioning/activation';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

const rubyAssets: AssetSource = {
  ...emptyAssets,
  async read(key) {
    if (key === 'ruby/global/.ruby-version') return '3.3.3\n';
    throw new Error(`unexpected asset ${key}`);
  },
};

const ok = (stdout = '', stderr = ''): CommandResult => ({
  code: 0,
  stdout,
  stderr,
});

test('reads inject asset values and captures feed later steps', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (_command, args) =>
      args.includes('--prefix') ? ok('/opt/homebrew\n') : ok(),
  });
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

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect(calls[1]?.args).toEqual(['3.3.3', '/opt/homebrew']);
});

test('skipIf with a satisfied pathExists guard marks the step unchanged', async () => {
  await withTemporaryDirectory(
    async (sandbox) => {
      const { context, calls } = recordingContext({
        home: sandbox,
        assets: rubyAssets,
        respond: () => ok(),
      });
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

      const report = await runActivation(activation, context);

      expect(calls).toHaveLength(0);
      expect(report.entries?.[0]?.status).toBe('unchanged');
      expect(report.status).toBe('unchanged');
    },
    { prefix: 'cmd-' },
  );
});

test('skipIf pathExists surfaces filesystem errors instead of running', async () => {
  await withTemporaryDirectory(
    async (sandbox) => {
      const blockedParent = join(sandbox, 'file-parent');
      await Bun.write(blockedParent, 'not a directory');
      const { context, calls } = recordingContext({
        home: sandbox,
        assets: rubyAssets,
        respond: () => ok(),
      });
      const activation = runCommand({
        label: 'demo',
        steps: [
          {
            label: 'install',
            argv: () => ['install'],
            skipIf: () => ({
              pathExists: join(blockedParent, 'tool'),
            }),
          },
        ],
      });

      const report = await runActivation(activation, context);

      expect(calls).toHaveLength(0);
      expect(report.status).toBe('failed');
      expect(report.error).toMatch(/not a directory/i);
    },
    { prefix: 'cmd-error-' },
  );
});

test('a non-zero step fails the activation and halts the pipeline', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command) =>
      command === 'boom' ? { code: 1, stdout: '', stderr: 'nope' } : ok(),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      { label: 'boom', argv: () => ['boom'] },
      { label: 'after', argv: () => ['after'] },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toBe('nope');
  expect(calls.map((c) => c.command)).toEqual(['boom']);
});

test('a non-zero step does not copy stdout into the error field', async () => {
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ({
      code: 1,
      stdout: 'secret-token',
      stderr: '',
    }),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [{ label: 'boom', argv: () => ['boom'] }],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toBe('exit code 1');
  expect(report.entries?.[0]?.error).not.toContain('secret-token');
});

test('env thunk output reaches the command runner', async () => {
  const { calls, context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [{ argv: () => ['x'], env: () => ({ FOO: 'bar' }) }],
  });

  await runActivation(activation, context);

  expect(calls[0]?.options?.env).toEqual({ FOO: 'bar' });
});

test('skipIf with a satisfied commandSucceeds guard runs with step env', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command, _args, options) => {
      if (command === 'check' && options?.env?.FOO === 'bar') {
        return ok();
      }
      return { code: 1, stdout: '', stderr: '' };
    },
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        label: 'install',
        argv: () => ['install'],
        skipIf: () => ({ commandSucceeds: ['check'] }),
        env: () => ({ FOO: 'bar' }),
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe('check');
  expect(report.entries?.[0]?.status).toBe('unchanged');
  expect(report.status).toBe('unchanged');
});

test('outputContains marks changed when phrase present in stderr', async () => {
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok('', 'Installed Python 3.12.11 (cpython)'),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        argv: () => ['uv', 'python', 'install', '3.12.11'],
        changedWhen: { outputContains: 'Installed Python' },
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
});

test('outputContains marks unchanged when phrase absent from combined output', async () => {
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok('', ''),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        argv: () => ['uv', 'python', 'install', '3.12.11'],
        changedWhen: { outputContains: 'Installed Python' },
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('unchanged');
});

test('outputNotContains checks stdout+stderr and marks unchanged when phrase present', async () => {
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok('', 'already installed v22'),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        argv: () => ['fnm', 'install', '22'],
        changedWhen: { outputNotContains: 'already installed' },
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('unchanged');
});

test('outputNotContains marks changed when phrase absent from combined output', async () => {
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok('Installed Node 22', ''),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        argv: () => ['fnm', 'install', '22'],
        changedWhen: { outputNotContains: 'already installed' },
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
});

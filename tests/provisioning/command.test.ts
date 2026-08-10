import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AssetSource } from '../../src/assets/registry';
import { runActivation, runCommand } from '../../src/provisioning/activation';
import { ok } from '../fixtures/fake-command-runner';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

const rubyAssets: AssetSource = {
  ...emptyAssets,
  async read(key) {
    if (key === 'ruby/.ruby-version') return '3.3.3\n';
    throw new Error(`unexpected asset ${key}`);
  },
};

test('command factory rejects empty step labels', () => {
  expect(() =>
    runCommand({
      label: 'demo',
      steps: [{ label: '', argv: ['install'] }],
    }),
  ).toThrow('non-empty label');
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
    reads: { version: 'ruby/.ruby-version' },
    steps: [
      {
        label: 'brew prefix',
        argv: ['brew', '--prefix'],
        capture: 'prefix',
        changedWhen: 'never',
      },
      {
        label: 'install',
        argv: ['install', { ref: 'version' }, { ref: 'prefix' }],
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
  expect(calls[1]?.args).toEqual(['3.3.3', '/opt/homebrew']);
});

test('home and basePath resolve as reserved scope references', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    basePath: '/usr/bin',
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        label: 'run',
        argv: [{ concat: [{ ref: 'home' }, '/bin/tool'] }, { ref: 'basePath' }],
      },
    ],
  });

  await runActivation(activation, context);

  expect(calls[0]?.command).toBe('/home/u/bin/tool');
  expect(calls[0]?.args).toEqual(['/usr/bin']);
});

test('splitRef expands a whitespace-separated reference into arguments', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: {
      ...emptyAssets,
      async read(key) {
        if (key === 'demo/components') return 'clippy  rustfmt\n';
        throw new Error(`unexpected asset ${key}`);
      },
    },
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    reads: { components: 'demo/components' },
    steps: [{ label: 'add', argv: ['add', { splitRef: 'components' }] }],
  });

  await runActivation(activation, context);

  expect(calls[0]?.args).toEqual(['clippy', 'rustfmt']);
});

test('a commandOutputMatches guard skips only on the exact declared output', async () => {
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/.ruby-version' },
    steps: [
      {
        label: 'install',
        argv: ['install', { ref: 'version' }],
        skipIf: {
          commandOutputMatches: {
            argv: ['tool', '--version'],
            exact: { ref: 'version' },
          },
        },
      },
    ],
  });

  const matching = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command) => (command === 'tool' ? ok('  3.3.3\n') : ok()),
  });
  expect((await runActivation(activation, matching.context)).status).toBe(
    'unchanged',
  );
  expect(matching.calls.map((call) => call.command)).toEqual(['tool']);

  const differing = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command) => (command === 'tool' ? ok('3.2.0\n') : ok()),
  });
  expect((await runActivation(activation, differing.context)).status).toBe(
    'changed',
  );
  expect(differing.calls.map((call) => call.command)).toEqual([
    'tool',
    'install',
  ]);
});

test('a commandOutputMatches guard with contains accepts decorated output', async () => {
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/.ruby-version' },
    steps: [
      {
        label: 'install',
        argv: ['install'],
        skipIf: {
          commandOutputMatches: {
            argv: ['tool', 'default'],
            contains: { ref: 'version' },
          },
        },
      },
    ],
  });
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command) =>
      command === 'tool' ? ok('3.3.3-aarch64-apple-darwin (default)\n') : ok(),
  });

  expect((await runActivation(activation, context)).status).toBe('unchanged');
  expect(calls.map((call) => call.command)).toEqual(['tool']);
});

test('a failing guard command never satisfies the guard', async () => {
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/.ruby-version' },
    steps: [
      {
        label: 'install',
        argv: ['install'],
        skipIf: {
          commandOutputMatches: {
            argv: ['tool', '--version'],
            exact: { ref: 'version' },
          },
        },
      },
    ],
  });
  const { context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    // Right output, non-zero exit: an uninstalled tool must not read as current.
    respond: (command) =>
      command === 'tool' ? { code: 1, stdout: '3.3.3\n', stderr: '' } : ok(),
  });

  expect((await runActivation(activation, context)).status).toBe('changed');
});

test('a pathList env value drops empty segments and joins with colon', async () => {
  const { calls, context } = recordingContext({
    home: '/home/u',
    basePath: '',
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [
      {
        label: 'x',
        argv: ['x'],
        env: {
          PATH: {
            pathList: [
              { concat: [{ ref: 'home' }, '/.local/bin'] },
              { ref: 'basePath' },
            ],
          },
        },
      },
    ],
  });

  await runActivation(activation, context);

  // The empty basePath is dropped rather than leaving a trailing separator.
  expect(calls[0]?.options?.env).toEqual({ PATH: '/home/u/.local/bin' });
});

test('a read binds the trimmed asset content', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: {
      ...emptyAssets,
      async read(key) {
        if (key === 'ruby/.ruby-version') return '  3.3.3  \n';
        throw new Error(`unexpected asset ${key}`);
      },
    },
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/.ruby-version' },
    steps: [{ label: 'x', argv: ['x', { ref: 'version' }] }],
  });

  await runActivation(activation, context);

  expect(calls[0]?.args).toEqual(['3.3.3']);
});

test('a missing read asset fails the activation before any step runs', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: {
      ...emptyAssets,
      async read(key) {
        throw new Error(`unknown asset ${key}`);
      },
    },
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    reads: { version: 'ruby/.ruby-version' },
    steps: [{ label: 'x', argv: ['x'] }],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('failed');
  expect(calls).toHaveLength(0);
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
            argv: ['install'],
            skipIf: { pathExists: sandbox },
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
            argv: ['install'],
            skipIf: { pathExists: join(blockedParent, 'tool') },
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
      { label: 'boom', argv: ['boom'] },
      { label: 'after', argv: ['after'] },
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
    steps: [{ label: 'boom', argv: ['boom'] }],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('failed');
  expect(report.entries?.[0]?.error).toBe('exit code 1');
  expect(report.entries?.[0]?.error).not.toContain('secret-token');
});

test('env value output reaches the command runner', async () => {
  const { calls, context } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: () => ok(),
  });
  const activation = runCommand({
    label: 'demo',
    steps: [{ label: 'x', argv: ['x'], env: { FOO: 'bar' } }],
  });

  await runActivation(activation, context);

  expect(calls[0]?.options?.env).toEqual({ FOO: 'bar' });
});

test('skipIf with a satisfied commandSucceeds guard runs with step env', async () => {
  const { context, calls } = recordingContext({
    home: '/home/u',
    assets: rubyAssets,
    respond: (command, _args, options) => {
      if (command === 'check' && options?.env?.['FOO'] === 'bar') {
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
        argv: ['install'],
        skipIf: { commandSucceeds: ['check'] },
        env: { FOO: 'bar' },
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
        label: 'uv python install',
        argv: ['uv', 'python', 'install', '3.12.11'],
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
        label: 'uv python install',
        argv: ['uv', 'python', 'install', '3.12.11'],
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
        label: 'fnm install',
        argv: ['fnm', 'install', '22'],
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
        label: 'fnm install',
        argv: ['fnm', 'install', '22'],
        changedWhen: { outputNotContains: 'already installed' },
      },
    ],
  });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('changed');
});

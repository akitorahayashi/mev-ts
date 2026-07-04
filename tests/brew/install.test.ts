import { expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installPackages } from '../../src/brew/install';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { type PackageToken, packages } from '../../src/provisioning/package';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

interface Sink {
  brewfile?: string;
  brewfilePath?: string;
  args?: string[];
}

function contextWith(code: number, sink: Sink = {}): Context {
  return {
    home: '/sandbox',
    overwrite: false,
    commands: {
      async run(_command, args): Promise<CommandResult> {
        sink.args = [...args];
        const fileArg = args.find((arg) => arg.startsWith('--file='));
        if (fileArg) {
          sink.brewfilePath = fileArg.slice('--file='.length);
          sink.brewfile = await readFile(sink.brewfilePath, 'utf8');
        }
        return { code, stdout: '', stderr: '' };
      },
    },
    assets: {
      async read() {
        return '';
      },
      keysByPrefix() {
        return [];
      },
      isExecutable() {
        return false;
      },
    },
  };
}

const oneFormula = packages({ formulae: ['git'] });

test('reports present when brew bundle check succeeds', async () => {
  const sink: Sink = {};
  const reports = await installPackages(oneFormula, contextWith(0, sink));

  expect(reports[0]?.status).toBe('present');
  expect(sink.brewfile).toBe('brew "git"\n');
  expect(sink.brewfilePath).toMatch(/Brewfile$/);
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('removes the Brewfile directory when the command runner throws', async () => {
  const sink: Sink = {};
  const context: Context = {
    ...contextWith(0, sink),
    commands: {
      async run(_command, args) {
        const fileArg = args.find((arg) => arg.startsWith('--file='));
        if (fileArg) {
          sink.brewfilePath = fileArg.slice('--file='.length);
        }
        throw new Error('runner failed');
      },
    },
  };

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toBe('runner failed');
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('reports failure when the command runner rejects without a reason', async () => {
  const context: Context = {
    ...contextWith(0),
    commands: {
      async run(): Promise<CommandResult> {
        return Promise.reject();
      },
    },
  };

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toBe('undefined');
});

test('allocates Brewfile scratch under the configured temporary root', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const root = join(dir, 'tmp root');
      await mkdir(root);
      const previous = Bun.env.TMPDIR;
      Bun.env.TMPDIR = root;
      const sink: Sink = {};

      try {
        await installPackages(oneFormula, contextWith(0, sink));
      } finally {
        if (previous === undefined) {
          delete Bun.env.TMPDIR;
        } else {
          Bun.env.TMPDIR = previous;
        }
      }

      expect(sink.brewfilePath?.startsWith(join(root, 'mev-brewfile-'))).toBe(
        true,
      );
      expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
    },
    { prefix: 'brew-tmp-root-' },
  );
});

test('attempts install with --no-upgrade for a missing formula', async () => {
  const sink: Sink = {};
  // check fails (missing) on every call, so install runs.
  const reports = await installPackages(oneFormula, contextWith(1, sink));

  expect(reports[0]?.status).toBe('failed');
  // The last brew invocation is the install attempt.
  expect(sink.args).toEqual([
    'bundle',
    'install',
    '--no-upgrade',
    expect.stringMatching(/^--file=/),
  ]);
});

test('hooks report the total and tick per token', async () => {
  const started: string[] = [];
  const ticked: PackageToken[] = [];
  let total = -1;
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git', 'gh'] }),
    contextWith(0),
    {
      onStart: (n) => {
        total = n;
      },
      onTokenStart: (token, stage) => {
        started.push(`${stage} ${token.kind} ${token.name}`);
      },
      onTick: (token) => ticked.push(token),
    },
  );
  expect(total).toBe(3);
  expect(started).toEqual([
    'checking tap a/b',
    'checking formula git',
    'checking formula gh',
  ]);
  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['present a/b', 'present git', 'present gh']);
  expect(ticked.map((t) => t.name)).toEqual(['a/b', 'git', 'gh']);
});

test('hooks report installing stage for missing packages', async () => {
  const started: string[] = [];

  const reports = await installPackages(oneFormula, contextWith(1), {
    onTokenStart: (token, stage) => {
      started.push(`${stage} ${token.kind} ${token.name}`);
    },
  });

  expect(started).toEqual(['checking formula git', 'installing formula git']);
  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['failed git']);
});

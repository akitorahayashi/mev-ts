import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { installPackages } from '../../src/brew/install';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { type PackageToken, packages } from '../../src/provisioning/package';

interface Sink {
  brewfile?: string;
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
          sink.brewfile = await readFile(
            fileArg.slice('--file='.length),
            'utf8',
          );
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
  const reports = await installPackages(
    oneFormula,
    contextWith(0, sink),
    false,
  );

  expect(reports[0]?.status).toBe('present');
  expect(sink.brewfile).toBe('brew "git"\n');
});

test('attempts install with --no-upgrade for a missing formula', async () => {
  const sink: Sink = {};
  // check fails (missing) on every call, so install runs.
  const reports = await installPackages(
    oneFormula,
    contextWith(1, sink),
    false,
  );

  expect(reports[0]?.status).toBe('failed');
  // The last brew invocation is the install attempt.
  expect(sink.args).toEqual([
    'bundle',
    'install',
    '--no-upgrade',
    expect.stringMatching(/^--file=/),
  ]);
});

test('plan mode reports missing without installing', async () => {
  const reports = await installPackages(oneFormula, contextWith(1), true);
  expect(reports[0]?.status).toBe('missing');
});

test('hooks report the total and tick per token', async () => {
  const started: string[] = [];
  const done: string[] = [];
  const ticked: PackageToken[] = [];
  let total = -1;
  await installPackages(
    packages({ taps: ['a/b'], formulae: ['git', 'gh'] }),
    contextWith(0),
    false,
    {
      onStart: (n) => {
        total = n;
      },
      onTokenStart: (token, stage) => {
        started.push(`${stage} ${token.kind} ${token.name}`);
      },
      onTokenDone: (report) => {
        done.push(`${report.status} ${report.token.name}`);
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
  expect(done).toEqual(['present a/b', 'present git', 'present gh']);
  expect(ticked.map((t) => t.name)).toEqual(['a/b', 'git', 'gh']);
});

test('hooks report installing stage for missing packages', async () => {
  const started: string[] = [];
  const done: string[] = [];

  await installPackages(oneFormula, contextWith(1), false, {
    onTokenStart: (token, stage) => {
      started.push(`${stage} ${token.kind} ${token.name}`);
    },
    onTokenDone: (report) => {
      done.push(`${report.status} ${report.token.name}`);
    },
  });

  expect(started).toEqual(['checking formula git', 'installing formula git']);
  expect(done).toEqual(['failed git']);
});

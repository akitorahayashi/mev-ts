import { expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installPackages } from '../../src/brew/install';
import { type PackageToken, packages } from '../../src/brew/package';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import { emptyAssets } from '../fixtures/fake-context';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

interface Sink {
  brewfile?: string;
  brewfilePath?: string;
  bundleArgs?: string[];
}

interface BrewState {
  readonly taps?: readonly string[];
  readonly formulae?: readonly string[];
  readonly casks?: readonly string[];
  readonly installCode?: number;
}

// Answers enumeration probes from the declared installed state and captures
// `brew bundle` invocations (with their temporary Brewfile) into the sink.
function brewContext(state: BrewState, sink: Sink = {}): Context {
  return {
    home: '/sandbox',
    basePath: '',
    commands: {
      async run(_command, args): Promise<CommandResult> {
        if (args[0] === 'tap') {
          return { code: 0, stdout: (state.taps ?? []).join('\n'), stderr: '' };
        }
        if (args[0] === 'list') {
          const names = args.includes('--cask') ? state.casks : state.formulae;
          return { code: 0, stdout: (names ?? []).join('\n'), stderr: '' };
        }
        sink.bundleArgs = [...args];
        const fileArg = args.find((arg) => arg.startsWith('--file='));
        if (fileArg) {
          sink.brewfilePath = fileArg.slice('--file='.length);
          sink.brewfile = await readFile(sink.brewfilePath, 'utf8');
        }
        return { code: state.installCode ?? 0, stdout: '', stderr: '' };
      },
    },
    assets: emptyAssets,
  };
}

const oneFormula = packages({ formulae: ['git'] });

test('reports present without invoking brew bundle when the formula is listed', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    oneFormula,
    brewContext({ formulae: ['git'] }, sink),
  );

  expect(reports[0]?.status).toBe('present');
  expect(sink.bundleArgs).toBeUndefined();
});

test('installs a missing formula through a temporary Brewfile', async () => {
  const sink: Sink = {};
  const reports = await installPackages(oneFormula, brewContext({}, sink));

  expect(reports[0]?.status).toBe('installed');
  expect(sink.brewfile).toBe('brew "git"\n');
  expect(sink.brewfilePath).toMatch(/Brewfile$/);
  expect(sink.bundleArgs).toEqual([
    'bundle',
    'install',
    '--no-upgrade',
    expect.stringMatching(/^--file=/),
  ]);
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('removes the Brewfile directory when the install runner throws', async () => {
  const sink: Sink = {};
  const context: Context = {
    ...brewContext({}),
    commands: {
      async run(_command, args) {
        if (args[0] === 'list') {
          return { code: 0, stdout: '', stderr: '' };
        }
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

test('reports failure when the enumeration rejects without a reason', async () => {
  const context: Context = {
    ...brewContext({}),
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

test('a failed enumeration fails every token of that kind without installing', async () => {
  const sink: Sink = {};
  const context: Context = {
    ...brewContext({}, sink),
    commands: {
      async run(_command, args): Promise<CommandResult> {
        if (args[0] === 'list') {
          return { code: 1, stdout: '', stderr: 'brew broken' };
        }
        sink.bundleArgs = [...args];
        return { code: 0, stdout: '', stderr: '' };
      },
    },
  };

  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    context,
  );

  expect(reports.map((report) => report.status)).toEqual(['failed', 'failed']);
  expect(reports[0]?.error).toBe(
    'brew list --formula -1 failed with code 1: brew broken',
  );
  expect(sink.bundleArgs).toBeUndefined();
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
        await installPackages(oneFormula, brewContext({}, sink));
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

test('installs a missing tap while present formulae skip the install step', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git'] }),
    brewContext({ formulae: ['git'] }, sink),
  );

  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['installed a/b', 'present git']);
  expect(sink.brewfile).toBe('tap "a/b"\n');
});

test('hooks report the total and tick per token', async () => {
  const started: PackageToken[] = [];
  const ticked: PackageToken[] = [];
  let total = -1;
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git', 'gh'] }),
    brewContext({ taps: ['a/b'], formulae: ['git', 'gh'] }),
    {
      onStart: (n) => {
        total = n;
      },
      onTokenStart: (token) => started.push(token),
      onTick: (token) => ticked.push(token),
    },
  );
  expect(total).toBe(3);
  expect(started).toEqual([]);
  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['present a/b', 'present git', 'present gh']);
  expect(ticked.map((t) => t.name)).toEqual(['a/b', 'git', 'gh']);
});

test('hooks report the installing token for missing packages', async () => {
  const started: string[] = [];

  const reports = await installPackages(
    oneFormula,
    brewContext({ installCode: 1 }),
    {
      onTokenStart: (token) => {
        started.push(`${token.kind} ${token.name}`);
      },
    },
  );

  expect(started).toEqual(['formula git']);
  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['failed git']);
});

test('rejects a token name that could break out of the Brewfile DSL', async () => {
  const reports = await installPackages(
    packages({ formulae: ['evil"\nbrew "malware'] }),
    brewContext({}),
  );

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toContain('unsafe Homebrew token name');
});

import { expect } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installPackages } from '../../src/brew/install';
import { type PackageToken, packages } from '../../src/brew/package';
import type { Context } from '../../src/host/context';
import {
  emptyAssets,
  type Invocation,
  recordingContext,
} from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

// Brewfile staging is real filesystem work, so every case runs against a
// sandbox home rather than a nonexistent path plus the real system temp root.
const test = sandboxedTest('brew-');

interface Sink {
  brewfile?: string;
  brewfilePath?: string;
  calls?: readonly Invocation[];
}

interface BrewState {
  readonly taps?: readonly string[];
  readonly formulae?: readonly string[];
  readonly casks?: readonly string[];
  readonly installCode?: number;
}

function brewContext(
  home: string,
  state: BrewState,
  sink: Sink = {},
  tmpRoot?: string,
): Context {
  const recorded = recordingContext({
    home,
    assets: emptyAssets,
    tmpRoot,
    async respond(_command, args) {
      if (args[0] === 'tap') {
        return { code: 0, stdout: (state.taps ?? []).join('\n'), stderr: '' };
      }
      if (args[0] === 'list') {
        const names = args.includes('--cask') ? state.casks : state.formulae;
        return { code: 0, stdout: (names ?? []).join('\n'), stderr: '' };
      }
      const fileArg = args.find((arg) => arg.startsWith('--file='));
      if (fileArg) {
        sink.brewfilePath = fileArg.slice('--file='.length);
        sink.brewfile = await readFile(sink.brewfilePath, 'utf8');
      }
      return { code: state.installCode ?? 0, stdout: '', stderr: '' };
    },
  });
  sink.calls = recorded.calls;
  return recorded.context;
}

const oneFormula = packages({ formulae: ['git'] });

function recordedArgs(sink: Sink): readonly (readonly string[])[] {
  return (sink.calls ?? [])
    .filter((call) => call.command === 'brew')
    .map((call) => call.args);
}

test('reports present without invoking brew bundle when the formula is listed', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, { formulae: ['git'] }, sink),
  );

  expect(reports[0]?.status).toBe('present');
  expect(recordedArgs(sink).some((args) => args[0] === 'bundle')).toBe(false);
});

test('upgrade mode upgrades an installed formula without invoking brew update', async (sandbox) => {
  const sink: Sink = {};
  const actions: string[] = [];
  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, { formulae: ['git'] }, sink),
    {
      upgrade: true,
      onTokenStart: (token, action) =>
        actions.push(`${action} ${token.kind} ${token.name}`),
    },
  );

  expect(reports[0]?.status).toBe('upgrade-applied');
  expect(recordedArgs(sink)).toContainEqual([
    'upgrade',
    '--no-ask',
    '--formula',
    'git',
  ]);
  expect(recordedArgs(sink).some((args) => args[0] === 'update')).toBe(false);
  expect(actions).toEqual(['upgrade formula git']);
});

test('upgrade mode upgrades an installed cask and leaves an installed tap alone', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ taps: ['a/b'], casks: ['zed'] }),
    brewContext(sandbox, { taps: ['a/b'], casks: ['zed'] }, sink),
    { upgrade: true },
  );

  expect(reports.map((report) => report.status)).toEqual([
    'present',
    'upgrade-applied',
  ]);
  expect(recordedArgs(sink)).toContainEqual([
    'upgrade',
    '--no-ask',
    '--cask',
    'zed',
  ]);
  expect(recordedArgs(sink)).not.toContainEqual([
    'upgrade',
    '--no-ask',
    '--tap',
    'a/b',
  ]);
});

test('upgrade mode installs a missing formula without invoking upgrade', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, {}, sink),
    { upgrade: true },
  );

  expect(reports[0]?.status).toBe('installed');
  expect(recordedArgs(sink).find((args) => args[0] === 'bundle')).toContain(
    '--no-upgrade',
  );
  expect(recordedArgs(sink).some((args) => args[0] === 'upgrade')).toBe(false);
});

test('a failed formula upgrade fails the package', async (sandbox) => {
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\n', stderr: '' };
      }
      if (args[0] === 'upgrade') {
        return { code: 1, stdout: '', stderr: 'upgrade unavailable' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  }).context;

  const reports = await installPackages(oneFormula, context, { upgrade: true });

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'git' },
    status: 'failed',
    error: 'brew upgrade failed for git with code 1: upgrade unavailable',
  });
});

test('installs a missing formula through a temporary Brewfile', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, {}, sink),
  );

  expect(reports[0]?.status).toBe('installed');
  expect(sink.brewfile).toBe('brew "git"\n');
  expect(sink.brewfilePath).toMatch(/Brewfile$/);
  expect(recordedArgs(sink).find((args) => args[0] === 'bundle')).toEqual([
    'bundle',
    'install',
    '--no-upgrade',
    expect.stringMatching(/^--file=/),
  ]);
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('removes the Brewfile directory when the install runner throws', async (sandbox) => {
  const sink: Sink = {};
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: '', stderr: '' };
      }
      const fileArg = args.find((arg) => arg.startsWith('--file='));
      if (fileArg) {
        sink.brewfilePath = fileArg.slice('--file='.length);
      }
      throw new Error('runner failed');
    },
  }).context;

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toBe('runner failed');
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('reports failure when the enumeration rejects without a reason', async (sandbox) => {
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond: () => Promise.reject(),
  }).context;

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toBe('undefined');
});

test('a failed enumeration fails every token of that kind without installing', async (sandbox) => {
  const { context, calls } = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 1, stdout: '', stderr: 'brew broken' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    context,
  );

  expect(reports.map((report) => report.status)).toEqual(['failed', 'failed']);
  expect(reports[0]?.error).toBe(
    'brew list --formula -1 failed with code 1: brew broken',
  );
  expect(calls.some((call) => call.args[0] === 'bundle')).toBe(false);
});

test('allocates Brewfile scratch under the injected temporary root', async (sandbox) => {
  const root = join(sandbox, 'tmp root');
  await mkdir(root);
  const sink: Sink = {};

  await installPackages(oneFormula, brewContext(sandbox, {}, sink, root));

  expect(sink.brewfilePath?.startsWith(join(root, 'mev-brewfile-'))).toBe(true);
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('installs a missing tap while present formulae skip the install step', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git'] }),
    brewContext(sandbox, { formulae: ['git'] }, sink),
  );

  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['installed a/b', 'present git']);
  expect(sink.brewfile).toBe('tap "a/b"\n');
});

test('hooks report the total and tick per token', async (sandbox) => {
  const started: PackageToken[] = [];
  const ticked: PackageToken[] = [];
  let total = -1;
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git', 'gh'] }),
    brewContext(sandbox, { taps: ['a/b'], formulae: ['git', 'gh'] }),
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

test('hooks report the installing token for missing packages', async (sandbox) => {
  const started: string[] = [];

  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, { installCode: 1 }),
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

test('rejects a token name that could break out of the Brewfile DSL', async (sandbox) => {
  const reports = await installPackages(
    packages({ formulae: ['evil"\nbrew "malware'] }),
    brewContext(sandbox, {}),
  );

  expect(reports[0]?.status).toBe('failed');
  expect(reports[0]?.error).toContain('unsafe Homebrew token name');
});

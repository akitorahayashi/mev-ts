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
  readonly formulaVersions?: Readonly<Record<string, readonly string[]>>;
  readonly caskVersions?: Readonly<Record<string, string>>;
  readonly upgradedFormulaVersions?: Readonly<
    Record<string, readonly string[]>
  >;
  readonly upgradedCaskVersions?: Readonly<Record<string, string>>;
  readonly installCode?: number;
}

function brewContext(
  home: string,
  state: BrewState,
  sink: Sink = {},
  tmpRoot?: string,
): Context {
  const upgraded = new Set<string>();
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
      if (args[0] === 'info') {
        const kind = args.includes('--cask') ? 'cask' : 'formula';
        const kindIndex = args.indexOf(`--${kind}`);
        const names = args.slice(kindIndex + 1);
        if (kind === 'cask') {
          return {
            code: 0,
            stdout: JSON.stringify({
              casks: names.map((name) => ({
                token: name,
                installed:
                  (upgraded.has(`cask:${name}`)
                    ? state.upgradedCaskVersions?.[name]
                    : undefined) ??
                  state.caskVersions?.[name] ??
                  '1.0.0',
              })),
            }),
            stderr: '',
          };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: names.map((name) => ({
              name,
              installed: (
                (upgraded.has(`formula:${name}`)
                  ? state.upgradedFormulaVersions?.[name]
                  : undefined) ??
                state.formulaVersions?.[name] ?? ['1.0.0']
              ).map((version) => ({ version })),
            })),
          }),
          stderr: '',
        };
      }
      if (args[0] === 'upgrade') {
        const kind = args.includes('--cask') ? 'cask' : 'formula';
        const name = args.at(-1);
        if (name) upgraded.add(`${kind}:${name}`);
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

test('upgrade mode reports an unchanged installed formula as current', async (sandbox) => {
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

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'git' },
    status: 'upgrade-current',
    versions: ['1.0.0'],
  });
  expect(recordedArgs(sink)).toContainEqual([
    'upgrade',
    '--no-ask',
    '--formula',
    'git',
  ]);
  expect(recordedArgs(sink).some((args) => args[0] === 'update')).toBe(false);
  expect(recordedArgs(sink).filter((args) => args[0] === 'info')).toHaveLength(
    2,
  );
  expect(actions).toEqual(['upgrade formula git']);
});

test('upgrade mode reports a changed installed formula with both versions', async (sandbox) => {
  const reports = await installPackages(
    oneFormula,
    brewContext(sandbox, {
      formulae: ['git'],
      formulaVersions: { git: ['2.50.0'] },
      upgradedFormulaVersions: { git: ['2.51.0'] },
    }),
    { upgrade: true },
  );

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'git' },
    status: 'upgraded',
    previousVersions: ['2.50.0'],
    versions: ['2.51.0'],
  });
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
    'upgrade-current',
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

test('installs a missing tap before probing an installed formula version', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ taps: ['a/b'], formulae: ['git'] }),
    brewContext(sandbox, { formulae: ['git'] }, sink),
    { upgrade: true },
  );

  expect(reports.map((report) => report.status)).toEqual([
    'installed',
    'upgrade-current',
  ]);
  expect(recordedArgs(sink).map((args) => args[0])).toEqual([
    'tap',
    'list',
    'bundle',
    'info',
    'upgrade',
    'info',
  ]);
  expect(sink.brewfile).toBe('tap "a/b"\n');
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
      if (args[0] === 'info') {
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: [{ name: 'git', installed: [{ version: '1.0.0' }] }],
          }),
          stderr: '',
        };
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

test('batches version probes per kind around multiple upgrades', async (sandbox) => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    brewContext(
      sandbox,
      {
        formulae: ['git', 'gh'],
        formulaVersions: { git: ['1.0.0'], gh: ['2.0.0'] },
      },
      sink,
    ),
    { upgrade: true },
  );

  expect(reports.map((report) => report.status)).toEqual([
    'upgrade-current',
    'upgrade-current',
  ]);
  expect(recordedArgs(sink).filter((args) => args[0] === 'info')).toEqual([
    ['info', '--json=v2', '--formula', 'git', 'gh'],
    ['info', '--json=v2', '--formula', 'git', 'gh'],
  ]);
});

test('does not upgrade when the pre-upgrade version probe fails', async (sandbox) => {
  const { context, calls } = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\n', stderr: '' };
      }
      if (args[0] === 'info') {
        return { code: 1, stdout: '', stderr: 'inventory unavailable' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const reports = await installPackages(oneFormula, context, {
    upgrade: true,
  });

  expect(reports[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('before upgrade'),
  });
  expect(calls.some((call) => call.args[0] === 'upgrade')).toBe(false);
});

test('a malformed package version does not prevent other upgrades in the batch', async (sandbox) => {
  let infoCalls = 0;
  const { context, calls } = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\ngh\n', stderr: '' };
      }
      if (args[0] === 'info') {
        infoCalls += 1;
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae:
              infoCalls === 1
                ? [
                    { name: 'git' },
                    { name: 'gh', installed: [{ version: '2.80.0' }] },
                  ]
                : [{ name: 'gh', installed: [{ version: '2.80.0' }] }],
          }),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    context,
    { upgrade: true },
  );

  expect(reports[0]).toMatchObject({ status: 'failed' });
  expect(reports[1]).toEqual({
    token: { kind: 'formula', name: 'gh' },
    status: 'upgrade-current',
    versions: ['2.80.0'],
  });
  expect(
    calls
      .filter((call) => call.args[0] === 'upgrade')
      .map((call) => call.args.at(-1)),
  ).toEqual(['gh']);
});

test('ticks each upgrade when its brew command completes', async (sandbox) => {
  const events: string[] = [];
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\ngh\n', stderr: '' };
      }
      if (args[0] === 'info') {
        events.push('info');
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: ['git', 'gh'].map((name) => ({
              name,
              installed: [{ version: '1.0.0' }],
            })),
          }),
          stderr: '',
        };
      }
      if (args[0] === 'upgrade') events.push(`upgrade ${args.at(-1)}`);
      return { code: 0, stdout: '', stderr: '' };
    },
  }).context;

  await installPackages(packages({ formulae: ['git', 'gh'] }), context, {
    upgrade: true,
    onTick: (token) => events.push(`tick ${token.name}`),
  });

  expect(events).toEqual([
    'info',
    'upgrade git',
    'tick git',
    'upgrade gh',
    'tick gh',
    'info',
  ]);
});

test('fails a successful upgrade when the post-upgrade version is absent', async (sandbox) => {
  let infoCalls = 0;
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\n', stderr: '' };
      }
      if (args[0] === 'info') {
        infoCalls += 1;
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: [
              {
                name: 'git',
                installed: infoCalls === 1 ? [{ version: '1.0.0' }] : [],
              },
            ],
          }),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  }).context;

  const reports = await installPackages(oneFormula, context, { upgrade: true });

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'git' },
    status: 'failed',
    error:
      'Homebrew post-upgrade inventory did not report an installed version for formula git.',
  });
});

test('fails a successful upgrade when the post-upgrade probe fails', async (sandbox) => {
  let infoCalls = 0;
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\n', stderr: '' };
      }
      if (args[0] === 'info') {
        infoCalls += 1;
        return infoCalls === 1
          ? {
              code: 0,
              stdout: JSON.stringify({
                formulae: [{ name: 'git', installed: [{ version: '1.0.0' }] }],
              }),
              stderr: '',
            }
          : { code: 1, stdout: '', stderr: 'inventory unavailable' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  }).context;

  const reports = await installPackages(oneFormula, context, { upgrade: true });

  expect(reports[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('after upgrade'),
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

  expect(reports[0]).toMatchObject({
    status: 'failed',
    error: 'runner failed',
  });
  expect(await Bun.file(sink.brewfilePath as string).exists()).toBe(false);
});

test('reports failure when the enumeration rejects without a reason', async (sandbox) => {
  const context = recordingContext({
    home: sandbox,
    assets: emptyAssets,
    respond: () => Promise.reject(),
  }).context;

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]).toMatchObject({ status: 'failed', error: 'undefined' });
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
  expect(reports[0]).toMatchObject({
    status: 'failed',
    error: 'brew list --formula -1 failed with code 1: brew broken',
  });
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

  expect(reports[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('unsafe Homebrew token name'),
  });
});

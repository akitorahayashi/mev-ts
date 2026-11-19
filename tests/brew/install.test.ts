import { expect, test } from 'bun:test';
import { installPackages } from '../../src/brew/install';
import type { PackageSet, PackageToken } from '../../src/brew/package';
import type { Context } from '../../src/host/context';
import {
  emptyAssets,
  type Invocation,
  recordingContext,
} from '../fixtures/fake-context';

const home = '/sandbox';

interface Sink {
  calls?: readonly Invocation[];
}

interface BrewState {
  readonly formulae?: readonly string[];
  readonly casks?: readonly string[];
  readonly formulaVersions?: Readonly<Record<string, readonly string[]>>;
  readonly caskVersions?: Readonly<Record<string, string>>;
  readonly upgradedFormulaVersions?: Readonly<
    Record<string, readonly string[]>
  >;
  readonly upgradedCaskVersions?: Readonly<Record<string, string>>;
  readonly installCode?: number;
  readonly trustRefused?: readonly string[];
}

function shortName(name: string): string {
  return name.split('/').at(-1) ?? name;
}

function packages(set: Partial<PackageSet>): PackageSet {
  return { formulae: set.formulae ?? [], casks: set.casks ?? [] };
}

function brewContext(state: BrewState, sink: Sink = {}): Context {
  const upgraded = new Set<string>();
  const recorded = recordingContext({
    home,
    assets: emptyAssets,
    async respond(_command, args) {
      if (args[0] === 'list') {
        const names = args.includes('--cask') ? state.casks : state.formulae;
        // Homebrew lists a tapped package by its bare name unless --full-name.
        const listed = args.includes('--full-name')
          ? (names ?? [])
          : (names ?? []).map(shortName);
        return { code: 0, stdout: listed.join('\n'), stderr: '' };
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
                token: shortName(name),
                full_token: name,
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
              name: shortName(name),
              full_name: name,
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
      if (args[0] === 'trust') {
        const refused = args.some((arg) => state.trustRefused?.includes(arg));
        return {
          code: refused ? 1 : 0,
          stdout: '',
          stderr: refused ? 'trust refused' : '',
        };
      }
      if (args[0] === 'upgrade') {
        const kind = args.includes('--cask') ? 'cask' : 'formula';
        const name = args.at(-1);
        if (name) upgraded.add(`${kind}:${name}`);
        return { code: 0, stdout: '', stderr: '' };
      }
      return state.installCode
        ? { code: state.installCode, stdout: '', stderr: 'install refused' }
        : { code: 0, stdout: '', stderr: '' };
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

test('reports present without installing when the formula is listed', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    oneFormula,
    brewContext({ formulae: ['git'] }, sink),
  );

  expect(reports[0]?.status).toBe('present');
  expect(recordedArgs(sink).some((args) => args[0] === 'install')).toBe(false);
});

test('upgrade mode reports an unchanged installed formula as current', async () => {
  const sink: Sink = {};
  const actions: string[] = [];
  const reports = await installPackages(
    oneFormula,
    brewContext({ formulae: ['git'] }, sink),
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

test('upgrade mode reports a changed installed formula with both versions', async () => {
  const reports = await installPackages(
    oneFormula,
    brewContext({
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

test('reports a tapped formula declared by its qualified name as present', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['owner/tap/tool'] }),
    brewContext({ formulae: ['owner/tap/tool'] }, sink),
  );

  expect(reports.map((report) => report.status)).toEqual(['present']);
  expect(recordedArgs(sink).some((args) => args[0] === 'install')).toBe(false);
  expect(recordedArgs(sink).some((args) => args[0] === 'trust')).toBe(false);
});

test('upgrade mode trusts a tapped formula before probing its version', async () => {
  const sink: Sink = {};
  await installPackages(
    packages({ formulae: ['git', 'owner/tap/tool'] }),
    brewContext({ formulae: ['git', 'owner/tap/tool'] }, sink),
    { upgrade: true },
  );

  const args = recordedArgs(sink);
  const trustIndex = args.findIndex((call) => call[0] === 'trust');
  expect(args[trustIndex]).toEqual(['trust', '--formula', 'owner/tap/tool']);
  expect(trustIndex).toBeLessThan(args.findIndex((call) => call[0] === 'info'));
});

test('trusts a missing tapped cask before installing it', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ casks: ['owner/tap/app'] }),
    brewContext({}, sink),
  );

  expect(reports[0]?.status).toBe('installed');
  expect(recordedArgs(sink)).toEqual([
    ['list', '--cask', '-1', '--full-name'],
    ['trust', '--cask', 'owner/tap/app'],
    ['install', '--cask', 'owner/tap/app'],
  ]);
});

test('a failed trust fails only its own tapped formula', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['git', 'owner/tap/bad', 'owner/tap/good'] }),
    brewContext(
      {
        formulae: ['git', 'owner/tap/bad', 'owner/tap/good'],
        trustRefused: ['owner/tap/bad'],
      },
      sink,
    ),
    { upgrade: true },
  );

  expect(reports.map((report) => report.status)).toEqual([
    'upgrade-current',
    'failed',
    'upgrade-current',
  ]);
  const failed = reports[1];
  expect(failed?.status === 'failed' && failed.error).toContain(
    'trust refused',
  );
  expect(
    recordedArgs(sink).some(
      (args) => args[0] !== 'trust' && args.includes('owner/tap/bad'),
    ),
  ).toBe(false);
});

test('upgrade mode upgrades a tapped formula under its qualified name', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['owner/tap/tool'] }),
    brewContext(
      {
        formulae: ['owner/tap/tool'],
        formulaVersions: { 'owner/tap/tool': ['1.0.0'] },
        upgradedFormulaVersions: { 'owner/tap/tool': ['1.1.0'] },
      },
      sink,
    ),
    { upgrade: true },
  );

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'owner/tap/tool' },
    status: 'upgraded',
    previousVersions: ['1.0.0'],
    versions: ['1.1.0'],
  });
  expect(recordedArgs(sink)).toContainEqual([
    'upgrade',
    '--no-ask',
    '--formula',
    'owner/tap/tool',
  ]);
});

test('upgrade mode upgrades an installed cask', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ casks: ['zed'] }),
    brewContext({ casks: ['zed'] }, sink),
    { upgrade: true },
  );

  expect(reports.map((report) => report.status)).toEqual(['upgrade-current']);
  expect(recordedArgs(sink)).toContainEqual([
    'upgrade',
    '--no-ask',
    '--cask',
    'zed',
  ]);
});

test('upgrade mode installs a missing formula without invoking upgrade', async () => {
  const sink: Sink = {};
  const reports = await installPackages(oneFormula, brewContext({}, sink), {
    upgrade: true,
  });

  expect(reports[0]?.status).toBe('installed');
  expect(recordedArgs(sink)).toContainEqual(['install', '--formula', 'git']);
  expect(recordedArgs(sink).some((args) => args[0] === 'upgrade')).toBe(false);
});

test('a failed formula upgrade fails the package', async () => {
  const context = recordingContext({
    home,
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        return { code: 0, stdout: 'git\n', stderr: '' };
      }
      if (args[0] === 'info') {
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: [{ full_name: 'git', installed: [{ version: '1.0.0' }] }],
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

test('batches version probes per kind around multiple upgrades', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    brewContext(
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

test('does not upgrade when the pre-upgrade version probe fails', async () => {
  const { context, calls } = recordingContext({
    home,
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

test('a malformed package version does not prevent other upgrades in the batch', async () => {
  let infoCalls = 0;
  const { context, calls } = recordingContext({
    home,
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
                    { full_name: 'git' },
                    { full_name: 'gh', installed: [{ version: '2.80.0' }] },
                  ]
                : [{ full_name: 'gh', installed: [{ version: '2.80.0' }] }],
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

test('ticks each upgrade when its brew command completes', async () => {
  const events: string[] = [];
  const context = recordingContext({
    home,
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
              full_name: name,
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

test('fails a successful upgrade when the post-upgrade version is absent', async () => {
  let infoCalls = 0;
  const context = recordingContext({
    home,
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
                full_name: 'git',
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

test('fails a successful upgrade when the post-upgrade probe fails', async () => {
  let infoCalls = 0;
  const context = recordingContext({
    home,
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
                formulae: [
                  { full_name: 'git', installed: [{ version: '1.0.0' }] },
                ],
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

test('installs missing formulae before missing casks by kind', async () => {
  const sink: Sink = {};
  const reports = await installPackages(
    packages({ formulae: ['git'], casks: ['zed'] }),
    brewContext({}, sink),
  );

  expect(reports.map((report) => report.status)).toEqual([
    'installed',
    'installed',
  ]);
  expect(recordedArgs(sink).filter((args) => args[0] === 'install')).toEqual([
    ['install', '--formula', 'git'],
    ['install', '--cask', 'zed'],
  ]);
});

test('reports a failed install with the brew diagnostic', async () => {
  const reports = await installPackages(
    oneFormula,
    brewContext({ installCode: 1 }),
  );

  expect(reports[0]).toEqual({
    token: { kind: 'formula', name: 'git' },
    status: 'failed',
    error: 'brew install failed for formula git with code 1: install refused',
  });
});

test('reports failure when the enumeration rejects without a reason', async () => {
  const context = recordingContext({
    home,
    assets: emptyAssets,
    respond: () => Promise.reject(),
  }).context;

  const reports = await installPackages(oneFormula, context);

  expect(reports[0]).toMatchObject({ status: 'failed', error: 'undefined' });
});

test('a failed enumeration fails every token of that kind without installing', async () => {
  const { context, calls } = recordingContext({
    home,
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
    error: 'brew list --formula -1 --full-name failed with code 1: brew broken',
  });
  expect(calls.some((call) => call.args[0] === 'install')).toBe(false);
});

test('hooks tick per token without starting present ones', async () => {
  const started: PackageToken[] = [];
  const ticked: PackageToken[] = [];
  const reports = await installPackages(
    packages({ formulae: ['git', 'gh'] }),
    brewContext({ formulae: ['git', 'gh'] }),
    {
      onTokenStart: (token) => started.push(token),
      onTick: (token) => ticked.push(token),
    },
  );
  expect(started).toEqual([]);
  expect(
    reports.map((report) => `${report.status} ${report.token.name}`),
  ).toEqual(['present git', 'present gh']);
  expect(ticked.map((t) => t.name)).toEqual(['git', 'gh']);
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

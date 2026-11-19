import { expect, test } from 'bun:test';
import type { PackageSet } from '../../src/brew/package';
import { uninstallPackages } from '../../src/brew/uninstall';
import { ok } from '../fixtures/fake-command-runner';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';

function packages(set: Partial<PackageSet>): PackageSet {
  return { formulae: set.formulae ?? [], casks: set.casks ?? [] };
}

interface BrewState {
  readonly formulae?: readonly string[];
  readonly casks?: readonly string[];
  readonly listCode?: number;
  readonly uninstallRefused?: readonly string[];
}

function brewContext(state: BrewState) {
  return recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond(_command, args) {
      if (args[0] === 'list') {
        if (state.listCode) {
          return { code: state.listCode, stdout: '', stderr: 'brew broken' };
        }
        const names = args.includes('--cask') ? state.casks : state.formulae;
        return ok((names ?? []).join('\n'));
      }
      if (
        args[0] === 'uninstall' &&
        state.uninstallRefused?.includes(args.at(-1) ?? '')
      ) {
        return { code: 1, stdout: '', stderr: 'required by other formulae' };
      }
      return ok();
    },
  });
}

function uninstallCalls(
  calls: { readonly args: readonly string[] }[],
): string[][] {
  return calls
    .filter((call) => call.args[0] === 'uninstall')
    .map((call) => [...call.args]);
}

test('removes installed casks with their data before installed formulae', async () => {
  const { context, calls } = brewContext({
    formulae: ['redis', 'owner/tap/tool'],
    casks: ['iina'],
  });

  const reports = await uninstallPackages(
    packages({ formulae: ['redis', 'owner/tap/tool'], casks: ['iina'] }),
    context,
  );

  expect(reports).toEqual([
    { token: { kind: 'cask', name: 'iina' }, status: 'uninstalled' },
    { token: { kind: 'formula', name: 'redis' }, status: 'uninstalled' },
    {
      token: { kind: 'formula', name: 'owner/tap/tool' },
      status: 'uninstalled',
    },
  ]);
  expect(uninstallCalls(calls)).toEqual([
    ['uninstall', '--cask', '--zap', 'iina'],
    ['uninstall', '--formula', 'redis'],
    ['uninstall', '--formula', 'owner/tap/tool'],
  ]);
});

test('reports an absent package without invoking uninstall', async () => {
  const { context, calls } = brewContext({ formulae: ['git'] });

  const reports = await uninstallPackages(
    packages({ formulae: ['redis'] }),
    context,
  );

  expect(reports).toEqual([
    { token: { kind: 'formula', name: 'redis' }, status: 'absent' },
  ]);
  expect(uninstallCalls(calls)).toEqual([]);
});

test('a refused uninstall fails only its own package', async () => {
  const { context } = brewContext({
    formulae: ['openssl@3', 'redis'],
    uninstallRefused: ['openssl@3'],
  });

  const reports = await uninstallPackages(
    packages({ formulae: ['openssl@3', 'redis'] }),
    context,
  );

  expect(reports).toEqual([
    {
      token: { kind: 'formula', name: 'openssl@3' },
      status: 'failed',
      error:
        'brew uninstall failed for formula openssl@3 with code 1: required by other formulae',
    },
    { token: { kind: 'formula', name: 'redis' }, status: 'uninstalled' },
  ]);
});

test('a failed enumeration fails every token of that kind without uninstalling', async () => {
  const { context, calls } = brewContext({ listCode: 1 });

  const reports = await uninstallPackages(
    packages({ formulae: ['redis'] }),
    context,
  );

  expect(reports).toEqual([
    {
      token: { kind: 'formula', name: 'redis' },
      status: 'failed',
      error:
        'brew list --formula -1 --full-name failed with code 1: brew broken',
    },
  ]);
  expect(uninstallCalls(calls)).toEqual([]);
});

test('hooks start only installed tokens and tick every token', async () => {
  const started: string[] = [];
  const ticked: string[] = [];
  const { context } = brewContext({ casks: ['iina'] });

  await uninstallPackages(
    packages({ formulae: ['redis'], casks: ['iina'] }),
    context,
    {
      onTokenStart: (token) => started.push(token.name),
      onTick: (token) => ticked.push(token.name),
    },
  );

  expect(started).toEqual(['iina']);
  expect(ticked).toEqual(['iina', 'redis']);
});

test('an empty set probes nothing', async () => {
  const { context, calls } = brewContext({});

  expect(await uninstallPackages(packages({}), context)).toEqual([]);
  expect(calls).toEqual([]);
});

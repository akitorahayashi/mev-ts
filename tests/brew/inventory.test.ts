import { expect, test } from 'bun:test';
import { loadInventory } from '../../src/brew/inventory';
import { packages } from '../../src/brew/package';
import { emptyAssets, recordingContext } from '../fixtures/fake-context';

const listed = (stdout: string) => ({ code: 0, stdout, stderr: '' }) as const;

function argsOf(calls: { readonly args: readonly string[] }[]): string[][] {
  return calls.map((call) => [...call.args]);
}

test('probes only the kinds the requirement declares', async () => {
  const { context, calls } = recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond: () => listed('git\n'),
  });

  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    context,
  );

  expect(argsOf(calls)).toEqual([['list', '--formula', '-1']]);
  expect(inventory.formula).toEqual({ loaded: true, names: new Set(['git']) });
  expect(inventory.tap).toEqual({ loaded: true, names: new Set() });
  expect(inventory.cask).toEqual({ loaded: true, names: new Set() });
});

test('enumerates each declared kind with its own command', async () => {
  const { context, calls } = recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond: () => listed(''),
  });

  await loadInventory(
    packages({ taps: ['a/b'], formulae: ['git'], casks: ['zed'] }),
    context,
  );

  expect(argsOf(calls)).toEqual([
    ['tap'],
    ['list', '--formula', '-1'],
    ['list', '--cask', '-1'],
  ]);
});

test('parses names per line, ignoring blanks and surrounding whitespace', async () => {
  const { context } = recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond: () => listed('git\n\n  gh  \n'),
  });

  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    context,
  );

  expect(inventory.formula).toEqual({
    loaded: true,
    names: new Set(['git', 'gh']),
  });
});

test('a nonzero enumeration exit is carried as a per-kind error', async () => {
  const { context } = recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond: () => ({ code: 1, stdout: '', stderr: 'brew broken' }),
  });

  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    context,
  );

  expect(inventory.formula).toEqual({
    loaded: false,
    error: 'brew list --formula -1 failed with code 1: brew broken',
  });
});

test('a throwing runner is carried as a per-kind error', async () => {
  const { context } = recordingContext({
    home: '/sandbox',
    assets: emptyAssets,
    respond: () => {
      throw new Error('runner failed');
    },
  });

  const inventory = await loadInventory(packages({ taps: ['a/b'] }), context);

  expect(inventory.tap).toEqual({ loaded: false, error: 'runner failed' });
});

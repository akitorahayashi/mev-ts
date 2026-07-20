import { expect, test } from 'bun:test';
import { emptyAssets } from '../../tests/fixtures/fake-context';
import type { CommandResult } from '../host/command';
import type { Context } from '../host/context';
import { loadInventory } from './inventory';
import { packages } from './package';

function inventoryContext(
  respond: (args: readonly string[]) => Promise<CommandResult>,
  calls: string[][] = [],
): Context {
  return {
    home: '/sandbox',
    basePath: '',
    commands: {
      async run(_command, args): Promise<CommandResult> {
        calls.push([...args]);
        return respond(args);
      },
    },
    assets: emptyAssets,
  };
}

const listed = (stdout: string) => async (): Promise<CommandResult> => ({
  code: 0,
  stdout,
  stderr: '',
});

test('probes only the kinds the requirement declares', async () => {
  const calls: string[][] = [];
  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    inventoryContext(listed('git\n'), calls),
  );

  expect(calls).toEqual([['list', '--formula', '-1']]);
  expect(inventory.formula).toEqual({ loaded: true, names: new Set(['git']) });
  expect(inventory.tap).toEqual({ loaded: true, names: new Set() });
  expect(inventory.cask).toEqual({ loaded: true, names: new Set() });
});

test('enumerates each declared kind with its own command', async () => {
  const calls: string[][] = [];
  await loadInventory(
    packages({ taps: ['a/b'], formulae: ['git'], casks: ['zed'] }),
    inventoryContext(listed(''), calls),
  );

  expect(calls).toEqual([
    ['tap'],
    ['list', '--formula', '-1'],
    ['list', '--cask', '-1'],
  ]);
});

test('parses names per line, ignoring blanks and surrounding whitespace', async () => {
  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    inventoryContext(listed('git\n\n  gh  \n')),
  );

  expect(inventory.formula).toEqual({
    loaded: true,
    names: new Set(['git', 'gh']),
  });
});

test('a nonzero enumeration exit is carried as a per-kind error', async () => {
  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    inventoryContext(async () => ({
      code: 1,
      stdout: '',
      stderr: 'brew broken',
    })),
  );

  expect(inventory.formula).toEqual({
    loaded: false,
    error: 'brew list --formula -1 failed with code 1: brew broken',
  });
});

test('a throwing runner is carried as a per-kind error', async () => {
  const inventory = await loadInventory(
    packages({ taps: ['a/b'] }),
    inventoryContext(async () => {
      throw new Error('runner failed');
    }),
  );

  expect(inventory.tap).toEqual({ loaded: false, error: 'runner failed' });
});

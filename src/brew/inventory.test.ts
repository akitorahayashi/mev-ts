import { expect, test } from 'bun:test';
import type { CommandResult } from '../host/command';
import type { Context } from '../host/context';
import { packages } from '../provisioning/package';
import { loadInventory } from './inventory';

function contextWith(
  respond: (args: readonly string[]) => Promise<CommandResult>,
  calls: string[][] = [],
): Context {
  return {
    home: '/sandbox',
    overwrite: false,
    commands: {
      async run(_command, args): Promise<CommandResult> {
        calls.push([...args]);
        return respond(args);
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

const listed = (stdout: string) => async (): Promise<CommandResult> => ({
  code: 0,
  stdout,
  stderr: '',
});

test('probes only the kinds the requirement declares', async () => {
  const calls: string[][] = [];
  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    contextWith(listed('git\n'), calls),
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
    contextWith(listed(''), calls),
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
    contextWith(listed('git\n\n  gh  \n')),
  );

  expect(inventory.formula).toEqual({
    loaded: true,
    names: new Set(['git', 'gh']),
  });
});

test('a nonzero enumeration exit is carried as a per-kind error', async () => {
  const inventory = await loadInventory(
    packages({ formulae: ['git'] }),
    contextWith(async () => ({ code: 1, stdout: '', stderr: 'brew broken' })),
  );

  expect(inventory.formula).toEqual({
    loaded: false,
    error: 'brew list --formula -1 failed with code 1: brew broken',
  });
});

test('a throwing runner is carried as a per-kind error', async () => {
  const inventory = await loadInventory(
    packages({ taps: ['a/b'] }),
    contextWith(async () => {
      throw new Error('runner failed');
    }),
  );

  expect(inventory.tap).toEqual({ loaded: false, error: 'runner failed' });
});

import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Glob } from 'bun';
import { Command, type CommandClass } from 'clipanion';
import { commands } from '../../src/cli/commands/registry';

const commandsDir = join(import.meta.dir, '..', '..', 'src', 'cli', 'commands');

function isCommandClass(value: unknown): value is CommandClass {
  return typeof value === 'function' && value.prototype instanceof Command;
}

test('every command class under cli/commands is in the registry', async () => {
  const registered = new Set<unknown>(commands);
  const missing: string[] = [];

  const glob = new Glob('**/*.ts');
  for await (const file of glob.scan({ cwd: commandsDir })) {
    if (file.endsWith('.test.ts')) continue;
    const module = await import(join(commandsDir, file));
    for (const [name, value] of Object.entries(module)) {
      if (isCommandClass(value) && !registered.has(value)) {
        missing.push(`${name} (${file})`);
      }
    }
  }

  expect(missing).toEqual([]);
});

test('the registry has no duplicate command classes', () => {
  expect(new Set(commands).size).toBe(commands.length);
});

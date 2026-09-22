import { expect, test } from 'bun:test';
import { commands } from '../../src/cli/commands/registry';

test('the registry has no duplicate command classes', () => {
  expect(new Set(commands).size).toBe(commands.length);
});

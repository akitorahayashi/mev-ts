import { expect, test } from 'bun:test';
import { runCommandLine } from '../../src/mev/cli/program';

test('exits 0 with no args and outputs help', async () => {
  const exitCode = await runCommandLine([]);
  expect(exitCode).toBe(0);
});

test('exits 0 for --help', async () => {
  const exitCode = await runCommandLine(['--help']);
  expect(exitCode).toBe(0);
});

test('exits 0 for --version', async () => {
  const exitCode = await runCommandLine(['--version']);
  expect(exitCode).toBe(0);
});

test('exits 1 for unknown command', async () => {
  const exitCode = await runCommandLine(['unknown']);
  expect(exitCode).toBe(1);
});

test('exits 1 for unknown top-level option', async () => {
  const exitCode = await runCommandLine(['--unknown']);
  expect(exitCode).toBe(1);
});

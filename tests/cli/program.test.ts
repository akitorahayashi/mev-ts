import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { runCommandLine } from '../../src/mev/cli/program';

let stdout: ReturnType<typeof spyOn>;
let stderr: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;

beforeEach(() => {
  stdout = spyOn(process.stdout, 'write').mockReturnValue(true);
  stderr = spyOn(process.stderr, 'write').mockReturnValue(true);
  log = spyOn(console, 'log').mockReturnValue(undefined);
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  log.mockRestore();
});

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

test('exits 0 for list', async () => {
  const exitCode = await runCommandLine(['list']);
  expect(exitCode).toBe(0);
});

test('exits 0 for ls alias', async () => {
  const exitCode = await runCommandLine(['ls']);
  expect(exitCode).toBe(0);
});

test('routes internal subcommands without exposing them in main help', async () => {
  const exitCode = await runCommandLine(['internal', '--help']);
  expect(exitCode).toBe(0);
});

test('exits 1 for unknown internal command', async () => {
  const exitCode = await runCommandLine(['internal', 'unknown']);
  expect(exitCode).toBe(1);
});

test('exits 1 for unknown internal option', async () => {
  const exitCode = await runCommandLine(['internal', '--unknown']);
  expect(exitCode).toBe(1);
});

test('exits 1 for incomplete multi-word internal command', async () => {
  const exitCode = await runCommandLine(['internal', 'gh', 'labels']);
  expect(exitCode).toBe(1);
});

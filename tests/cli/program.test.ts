import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { runCommandLine } from '../../src/mev/cli/program';

let stdout: ReturnType<typeof spyOn>;
let stderr: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;

function written(spy: ReturnType<typeof spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

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

test('exits 0 for per-command help and renders that command once', async () => {
  const exitCode = await runCommandLine(['make', '--help']);
  expect(exitCode).toBe(0);
  const rendered = written(stdout);
  expect(rendered).toContain('make <tags...>');
});

test('unknown command with --help renders help exactly once', async () => {
  const exitCode = await runCommandLine(['id', '--help']);
  expect(exitCode).toBe(1);
  const stdoutText = written(stdout);
  const stderrText = written(stderr);
  expect(stderrText).toContain("Unknown command 'id'.");
  expect(stdoutText.split('Commands').length - 1).toBe(1);
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

// These reach the git command modules and fail on argument validation before
// any git process is spawned, confirming the dispatch wiring per command.
test('routes git clone and rejects an empty url list', async () => {
  const exitCode = await runCommandLine(['internal', 'git', 'clone']);
  expect(exitCode).toBe(1);
});

test('routes git delete-branches and rejects an empty branch list', async () => {
  const exitCode = await runCommandLine(['internal', 'git', 'delete-branches']);
  expect(exitCode).toBe(1);
});

test('routes git delete-submodule and rejects an absolute path', async () => {
  const exitCode = await runCommandLine([
    'internal',
    'git',
    'delete-submodule',
    '/abs',
  ]);
  expect(exitCode).toBe(1);
});

import { expect, test } from 'bun:test';
import packageMetadata from '../../package.json';
import { runCommandLine } from '../../src/main';

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function stripAnsi(text: string): string {
  return Bun.stripANSI(text);
}

async function capture(args: readonly string[]): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;

  process.stdout.write = ((
    chunk: unknown,
    encoding?: unknown,
    cb?: unknown,
  ) => {
    stdout +=
      chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof cb === 'function') cb();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((
    chunk: unknown,
    encoding?: unknown,
    cb?: unknown,
  ) => {
    stderr +=
      chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof cb === 'function') cb();
    return true;
  }) as typeof process.stderr.write;

  try {
    const code = await runCommandLine(args);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

test('version prints to stdout and exits successfully', async () => {
  const result = await capture(['--version']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(packageMetadata.version);
  expect(result.stderr).toBe('');
});

test('help prints command usage to stdout', async () => {
  const result = await capture(['--help']);
  const stdout = stripAnsi(result.stdout);

  expect(result.code).toBe(0);
  expect(stdout).toContain('$ mev <command>');
  expect(stdout).toContain('make');
  expect(result.stderr).toBe('');
});

test('list alias routes to the target list', async () => {
  const result = await capture(['ls']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('git');
  expect(result.stdout).toContain('shell');
  expect(result.stderr).toBe('');
});

test('config prints its subcommands', async () => {
  const result = await capture(['config']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev config <command>');
  expect(result.stdout).toContain('mev config select');
  expect(result.stderr).toBe('');
});

test('config alias routes to the same subcommand listing', async () => {
  const result = await capture(['cf']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev cf <command>');
  expect(result.stdout).toContain('mev config select');
  expect(result.stderr).toBe('');
});

test('config --help shows the subcommand listing instead of an ambiguous match', async () => {
  const result = await capture(['config', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev config <command>');
  expect(result.stdout).not.toContain('Multiple commands match');
  expect(result.stderr).toBe('');
});

test('cf --help shows the subcommand listing instead of an ambiguous match', async () => {
  const result = await capture(['cf', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev cf <command>');
  expect(result.stdout).not.toContain('Multiple commands match');
  expect(result.stderr).toBe('');
});

test('list --help still shows detailed usage for a leaf command', async () => {
  const result = await capture(['list', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev list');
  expect(result.stdout).not.toContain('Multiple commands match');
  expect(result.stderr).toBe('');
});

test('usage errors print guidance to stdout', async () => {
  const result = await capture(['config', 'select', 'unknown']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Unknown selectable 'unknown'");
  expect(result.stdout).toContain('Usage');
  expect(result.stderr).toBe('');
});

test('unknown commands print usage errors to stdout', async () => {
  const result = await capture(['unknown-command']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Command not found');
  expect(result.stderr).toBe('');
});

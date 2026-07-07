import { expect, test } from 'bun:test';
import packageMetadata from '../../package.json';
import { runCommandLine } from '../../src/main';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

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
  expect(result.stdout).toContain('mev config agents');
  expect(result.stdout).toContain('mev config skills');
  expect(result.stdout).toContain('mev config zed');
  expect(result.stderr).toBe('');
});

test('config alias routes to the same subcommand listing', async () => {
  const result = await capture(['cf']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev cf <command>');
  expect(result.stdout).toContain('mev config agents');
  expect(result.stdout).toContain('mev config skills');
  expect(result.stdout).toContain('mev config zed');
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

test('user prints its subcommands', async () => {
  const result = await capture(['user']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev user <command>');
  expect(result.stdout).toContain('mev user show');
  expect(result.stdout).toContain('mev user set');
  expect(result.stderr).toBe('');
});

test('user --help shows the subcommand listing instead of an ambiguous match', async () => {
  const result = await capture(['user', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev user <command>');
  expect(result.stdout).toContain('mev user set');
  expect(result.stdout).not.toContain('Multiple commands match');
  expect(result.stderr).toBe('');
});

test('us --help shows the subcommand listing instead of an ambiguous match', async () => {
  const result = await capture(['us', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('mev us <command>');
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
  const result = await capture(['config', 'agents', 'unexpected']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Extraneous positional argument');
  expect(result.stdout).toContain('mev config agents');
  expect(result.stderr).toBe('');
});

test('unknown commands print usage errors to stdout', async () => {
  const result = await capture(['unknown-command']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Command not found');
  expect(result.stderr).toBe('');
});

test('domain errors print concise diagnostics to stderr', async () => {
  const originalHome = process.env.HOME;
  await withTemporaryDirectory(async (home) => {
    try {
      process.env.HOME = home;

      const result = await capture(['config', 'agents', '--clear']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('ProvisioningError:');
      expect(result.stderr).toContain('Run provisioning to deploy it first');
      expect(result.stdout).not.toContain(
        'Run provisioning to deploy it first',
      );
      expect(
        stripAnsi(result.stderr)
          .split('\n')
          .some((line) => line.startsWith('    at ')),
      ).toBe(false);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});

test('config agents and skills commands resolve via all alias permutations', async () => {
  const agentPermutations = [
    ['config', 'agents'],
    ['config', 'ag'],
    ['cf', 'agents'],
    ['cf', 'ag'],
  ];

  for (const perm of agentPermutations) {
    const result = await capture([...perm, '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'Interactively select enabled AGENTS.md sections.',
    );
    expect(result.stderr).toBe('');
  }

  const skillPermutations = [
    ['config', 'skills'],
    ['config', 'sk'],
    ['cf', 'skills'],
    ['cf', 'sk'],
  ];

  for (const perm of skillPermutations) {
    const result = await capture([...perm, '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Interactively select enabled skills.');
    expect(result.stderr).toBe('');
  }
});

test('config zed command resolves via all alias permutations', async () => {
  const zedPermutations = [
    ['config', 'zed'],
    ['config', 'zd'],
    ['cf', 'zed'],
    ['cf', 'zd'],
  ];

  for (const perm of zedPermutations) {
    const result = await capture([...perm, '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'Interactively select enabled Zed setting overrides.',
    );
    expect(result.stderr).toBe('');
  }
});

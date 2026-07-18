import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BaseContext } from 'clipanion';
import packageMetadata from '../../package.json';
import { embeddedAssets } from '../../src/assets/registry';
import { runCommandLine } from '../../src/main';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { fullSetupTargets } from '../../src/provisioning/registry';
import { targetSignature } from '../../src/provisioning/signature';
import { recordingContext } from '../fixtures/fake-context';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function stripAnsi(text: string): string {
  return Bun.stripANSI(text);
}

function memoryWriter(sink: (text: string) => void) {
  return (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    sink(
      chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : String(chunk),
    );
    if (typeof encoding === 'function') encoding();
    if (typeof cb === 'function') cb();
    return true;
  };
}

// Inject in-memory streams through clipanion's context instead of patching the
// process globals, so capture is isolated and parallel-safe.
async function capture(args: readonly string[]): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const context = {
    stdout: {
      write: memoryWriter((text) => {
        stdout += text;
      }),
    },
    stderr: {
      write: memoryWriter((text) => {
        stderr += text;
      }),
    },
  } as unknown as Partial<BaseContext>;

  const code = await runCommandLine(args, context);
  return { code, stdout, stderr };
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
  expect(stdout).toContain('sync');
  expect(result.stderr).toBe('');
});

test('sync requires a profile', async () => {
  const result = await capture(['sync']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Not enough positional arguments');
  expect(result.stdout).toContain('mev sync');
  expect(result.stderr).toBe('');
});

test('sync rejects an unknown profile as a usage error', async () => {
  const result = await capture(['sync', 'desktop']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Unknown profile 'desktop'.");
  expect(result.stdout).toContain('mev sync');
  expect(result.stderr).toBe('');
});

test('sync exits without provisioning when the full setup is current', async () => {
  const originalHome = process.env.HOME;
  await withTemporaryDirectory(async (home) => {
    const context = recordingContext({ home, assets: embeddedAssets }).context;
    for (const target of fullSetupTargets()) {
      await deployRole(target.role, context);
      await writeApplied(
        appliedPath(home, target.name),
        await targetSignature(target, embeddedAssets),
      );
    }

    try {
      process.env.HOME = home;
      const result = await capture(['sync', 'mbk']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        'mev: macbook environment is synchronized',
      );
      expect(result.stdout).not.toContain('Running tags:');
      expect(result.stderr).toBe('');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
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

test('wrapped command usage errors still print guidance to stdout', async () => {
  const result = await capture(['switch', 'nope']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Unknown identity 'nope'.");
  expect(result.stdout).toContain('mev switch');
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

test('a corrupt selection manifest exits 1 with a labeled error on stderr', async () => {
  const originalHome = process.env.HOME;
  await withTemporaryDirectory(async (home) => {
    try {
      process.env.HOME = home;
      // A valid catalog so selection resolution reaches the manifest read.
      const catalogDir = join(home, '.mev/roles/coder/global/agents-sections');
      await mkdir(catalogDir, { recursive: true });
      await writeFile(
        join(catalogDir, 'catalog.yml'),
        'sections:\n  - alpha\n',
      );
      await writeFile(join(catalogDir, 'alpha.md'), '## Alpha\n');
      const manifestDir = join(home, '.mev/coder');
      await mkdir(manifestDir, { recursive: true });
      await writeFile(
        join(manifestDir, 'agents-sections.yml'),
        '{ invalid yaml',
      );

      const result = await capture(['cf', 'agents']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Failed to parse YAML');
      expect(result.stderr).toContain('agents-sections.yml');
      expect(result.stdout).not.toContain('Failed to parse YAML');
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
    expect(result.stdout).toContain('mev config agents');
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
    expect(result.stdout).toContain('mev config skills');
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
    expect(result.stdout).toContain('mev config zed');
    expect(result.stderr).toBe('');
  }
});

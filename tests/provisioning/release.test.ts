import { expect, test } from 'bun:test';
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { CommandResult } from '../../src/host/command';
import type { Context } from '../../src/host/context';
import {
  releaseBinaries,
  runActivation,
} from '../../src/provisioning/activation';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

type Responder = (command: string, args: readonly string[]) => CommandResult;

async function withSandbox(fn: (home: string) => Promise<void>): Promise<void> {
  await withTemporaryDirectory(fn, { prefix: 'release-' });
}

function contextWith(
  home: string,
  responder: Responder,
): { context: Context; calls: Call[] } {
  const calls: Call[] = [];
  const context: Context = {
    home,
    overwrite: false,
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
    commands: {
      // A successful download writes the destination file, so the subsequent
      // chmod in fetchReleaseBinary has a real file to mark executable.
      async run(command, args) {
        calls.push({ command, args });
        const result = responder(command, args);
        if (result.code === 0 && (command === 'curl' || command === 'gh')) {
          const flag = command === 'curl' ? '-o' : '--output';
          const i = args.indexOf(flag);
          if (i >= 0) await writeFile(args[i + 1] as string, command);
        }
        return result;
      },
    },
  };
  return { context, calls };
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = ''): CommandResult => ({ code: 1, stdout: '', stderr });

const CONFIG_KEY = 'rust-cli/global/binaries.yml';

async function deployBinaries(home: string, yaml: string): Promise<void> {
  const roleDir = join(home, '.config', 'mev', 'roles', 'rust-cli', 'global');
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, 'binaries.yml'), yaml);
}

const PUBLIC_YAML = `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
  - name: mx
    repo: akitorahayashi/mx
    tag: v3.1.0
`.trimStart();

// A missing binary makes the `<dest> --version` probe spawn an absent
// executable, which throws ENOENT synchronously. installedMatches must treat
// that as "not installed" rather than letting it abort the batch.
const absentProbe = (args: readonly string[]): void => {
  if (args[0] === '--version') {
    throw new Error('ENOENT: no such file or directory, posix_spawn');
  }
};

test('first run: an absent binary is fetched and installed, not aborted', async () => {
  await withSandbox(async (home) => {
    await deployBinaries(home, PUBLIC_YAML);
    const { context, calls } = contextWith(home, (command, args) => {
      absentProbe(args);
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(report.entries?.map((e) => e.status)).toEqual([
      'changed',
      'changed',
    ]);
    expect(calls.filter((c) => c.command === 'curl')).toHaveLength(2);
    expect(await readFile(join(home, '.cargo', 'bin', 'kpv'), 'utf8')).toBe(
      'curl',
    );
  });
});

test('one binary failing still processes its siblings', async () => {
  await withSandbox(async (home) => {
    await deployBinaries(home, PUBLIC_YAML);
    const { context } = contextWith(home, (command, args) => {
      absentProbe(args);
      if (command === 'uname') return ok('arm64');
      if (command === 'curl') {
        return args.some((a) => a.includes('mx-darwin'))
          ? fail('404 not found')
          : ok();
      }
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(report.entries?.find((e) => e.key === 'kpv')?.status).toBe(
      'changed',
    );
    const mx = report.entries?.find((e) => e.key === 'mx');
    expect(mx?.status).toBe('failed');
    expect(mx?.error).toBe('404 not found');
  });
});

test('an up-to-date binary is left unchanged and not re-fetched', async () => {
  await withSandbox(async (home) => {
    await deployBinaries(home, PUBLIC_YAML);
    const { context, calls } = contextWith(home, (command, args) => {
      if (command === 'uname') return ok('arm64');
      if (args[0] === '--version') {
        if (command.endsWith('/kpv')) return ok('kpv 0.6.0');
        if (command.endsWith('/mx')) return ok('mx 3.1.0');
      }
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('unchanged');
    expect(report.entries?.every((e) => e.status === 'unchanged')).toBe(true);
    expect(calls.some((c) => c.command === 'curl')).toBe(false);
  });
});

test('a private binary is fetched with an authenticated gh download', async () => {
  await withSandbox(async (home) => {
    await deployBinaries(
      home,
      `
binaries:
  - name: astm
    repo: asterismhq/asterism
    tag: v27.0.2
    private: true
`.trimStart(),
    );
    const { context, calls } = contextWith(home, (command, args) => {
      absentProbe(args);
      if (command === 'uname') return ok('arm64');
      if (command === 'gh') return ok();
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('changed');
    expect(calls.some((c) => c.command === 'curl')).toBe(false);
    const gh = calls.find((c) => c.command === 'gh');
    expect(gh).toBeDefined();
    const output = gh?.args[gh.args.indexOf('--output') + 1] as string;
    expect(dirname(dirname(output))).toBe(
      await realpath(join(home, '.cargo', 'bin')),
    );
    expect(basename(dirname(output)).startsWith('.astm.')).toBe(true);
    expect(gh?.args).toEqual([
      'release',
      'download',
      'v27.0.2',
      '--repo',
      'asterismhq/asterism',
      '--pattern',
      'astm-darwin-aarch64',
      '--output',
      output,
      '--clobber',
    ]);
    expect(await readFile(join(home, '.cargo', 'bin', 'astm'), 'utf8')).toBe(
      'gh',
    );
  });
});

test('a failed download keeps the existing binary and removes temp files', async () => {
  await withSandbox(async (home) => {
    const existing = join(home, '.cargo', 'bin', 'kpv');
    await mkdir(join(existing, '..'), { recursive: true });
    await writeFile(existing, 'old');
    await deployBinaries(
      home,
      `
binaries:
  - name: kpv
    repo: akitorahayashi/kpv
    tag: v0.6.0
`.trimStart(),
    );
    const { context } = contextWith(home, (command, args) => {
      if (command === 'uname') return ok('arm64');
      if (args[0] === '--version') return fail();
      if (command === 'curl') return fail('network down');
      return fail();
    });

    const report = await runActivation(releaseBinaries(CONFIG_KEY), context);

    expect(report.status).toBe('failed');
    expect(await readFile(existing, 'utf8')).toBe('old');
    expect(await readdir(join(home, '.cargo', 'bin'))).toEqual(['kpv']);
  });
});

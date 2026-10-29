import { expect } from 'bun:test';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { writeSshHost } from '../../src/github/ssh-host';
import type { CommandResult } from '../../src/host/command';
import { home } from '../../src/host/path';
import { loadToml } from '../../src/host/toml';
import { groveConfig, runActivation } from '../../src/provisioning/activation';
import type { ActivationReport } from '../../src/provisioning/activation/contract';
import { outcomeStatus } from '../../src/provisioning/resource-outcome';
import { type Responder, recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-grove-config-');
const source = { key: 'grove/grove.toml' };
const activation = groveConfig(source, home('Desktop/grove.toml'));

const CONFIG = `version = 2

[groups.TypeScript]
github = "git@github.com:owner/github.git"
other = "git@gitlab.example:owner/other.git"
`;

async function deployConfig(homeDir: string): Promise<void> {
  const path = deployedPath(source, homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, CONFIG);
}

function destination(homeDir: string): string {
  return join(homeDir, 'Desktop/grove.toml');
}

async function writeDestination(homeDir: string, text: string): Promise<void> {
  await mkdir(dirname(destination(homeDir)), { recursive: true });
  await writeFile(destination(homeDir), text);
}

function exited(code: number, stdout = '', stderr = ''): CommandResult {
  return { code, stdout, stderr };
}

// A converged `gv replace` writes the candidate to its --config destination.
function convergingGrove(stdout = ''): Responder {
  return async (_command, args) => {
    await copyFile(args[3] ?? '', args[1] ?? '');
    return exited(0, stdout);
  };
}

function failure(report: ActivationReport): string | undefined {
  return report.outcomes.find((outcome) => outcome.status === 'failed')?.error;
}

sandboxTest(
  'hands the SSH-alias render to the installed gv replace for the destination',
  async (homeDir) => {
    await deployConfig(homeDir);
    await writeSshHost(homeDir, 'github-work');
    let candidate = '';
    let candidateConfig: Record<string, unknown> = {};
    const { context, calls } = recordingContext({
      home: homeDir,
      respond: async (command, args, options) => {
        candidate = args[3] ?? '';
        candidateConfig = loadToml(
          await readFile(candidate, 'utf8'),
          'grove candidate',
        );
        return convergingGrove()(command, args, options);
      },
    });

    await runActivation(activation, context);

    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      [
        join(homeDir, '.cargo/bin/gv'),
        '--config',
        destination(homeDir),
        'replace',
        candidate,
      ],
    ]);
    expect(isAbsolute(candidate)).toBe(true);
    expect(candidateConfig).toEqual({
      version: 2,
      groups: {
        TypeScript: {
          github: 'git@github-work:owner/github.git',
          other: 'git@gitlab.example:owner/other.git',
        },
      },
    });
  },
);

async function scratchAfterReplace(
  homeDir: string,
  grove: Responder,
): Promise<{ candidate: string; tmpRoot: string; leftover: string[] }> {
  await deployConfig(homeDir);
  const tmpRoot = join(homeDir, 'tmp');
  await mkdir(tmpRoot);
  let candidate = '';
  const { context } = recordingContext({
    home: homeDir,
    tmpRoot,
    respond: (command, args, options) => {
      candidate = args[3] ?? '';
      return grove(command, args, options);
    },
  });
  await runActivation(activation, context);
  return { candidate, tmpRoot, leftover: await readdir(tmpRoot) };
}

sandboxTest(
  'removes the candidate workspace after gv replace succeeds',
  async (homeDir) => {
    const { candidate, tmpRoot, leftover } = await scratchAfterReplace(
      homeDir,
      convergingGrove(),
    );

    expect(candidate.startsWith(`${tmpRoot}/`)).toBe(true);
    expect(leftover).toEqual([]);
  },
);

sandboxTest(
  'removes the candidate workspace after gv replace fails',
  async (homeDir) => {
    const { candidate, tmpRoot, leftover } = await scratchAfterReplace(
      homeDir,
      () => exited(1, '', 'unknown field'),
    );

    expect(candidate.startsWith(`${tmpRoot}/`)).toBe(true);
    expect(leftover).toEqual([]);
  },
);

sandboxTest(
  "fails with grove's report and leaves the destination when replace is blocked",
  async (homeDir) => {
    await deployConfig(homeDir);
    await writeDestination(homeDir, 'version = 2\n');
    const { context } = recordingContext({
      home: homeDir,
      respond: () =>
        exited(
          1,
          'blocked TypeScript/stale: uncommitted changes\n',
          'replace blocked\n',
        ),
    });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
    expect(failure(report)).toContain(
      'blocked TypeScript/stale: uncommitted changes',
    );
    expect(failure(report)).toContain('replace blocked');
    expect(await readFile(destination(homeDir), 'utf8')).toBe('version = 2\n');
  },
);

sandboxTest(
  'reports changed for an absent destination and unchanged once it matches, replacing both times',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context, calls } = recordingContext({
      home: homeDir,
      respond: convergingGrove(),
    });

    const first = await runActivation(activation, context);
    const second = await runActivation(activation, context);

    expect(outcomeStatus(first.outcomes)).toBe('changed');
    expect(outcomeStatus(second.outcomes)).toBe('unchanged');
    expect(calls).toHaveLength(2);
  },
);

sandboxTest(
  'reports changed when the destination differs from the render',
  async (homeDir) => {
    await deployConfig(homeDir);
    await writeDestination(homeDir, 'version = 2\n');
    const { context } = recordingContext({
      home: homeDir,
      respond: convergingGrove(),
    });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('changed');
  },
);

sandboxTest("relays grove's report lines as notices", async (homeDir) => {
  await deployConfig(homeDir);
  const { context } = recordingContext({
    home: homeDir,
    respond: convergingGrove(
      '  moved Skills/old -> Skills/new\n\n  trashed Skills/gone\n',
    ),
  });

  const report = await runActivation(activation, context);

  expect(report.notices).toEqual([
    'moved Skills/old -> Skills/new',
    'trashed Skills/gone',
  ]);
});

sandboxTest(
  'fails when gv replace succeeds without writing the destination',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context } = recordingContext({
      home: homeDir,
      respond: () => exited(0),
    });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
  },
);

sandboxTest(
  'fails for a malformed stored SSH host without running gv',
  async (homeDir) => {
    await deployConfig(homeDir);
    await mkdir(join(homeDir, '.mev'), { recursive: true });
    await writeFile(join(homeDir, '.mev/ssh-host'), 'git@github.com\n');
    const { context, calls } = recordingContext({ home: homeDir });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
    expect(failure(report)).toContain('GitHub SSH host');
    expect(calls).toEqual([]);
  },
);

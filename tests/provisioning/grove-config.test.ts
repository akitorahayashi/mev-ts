import { expect } from 'bun:test';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

async function deployConfig(homeDir: string, config = CONFIG): Promise<void> {
  const path = deployedPath(source, homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, config);
}

function destination(homeDir: string): string {
  return join(homeDir, 'Desktop/grove.toml');
}

async function repoUrls(homeDir: string): Promise<Record<string, string>> {
  const parsed = loadToml(
    await readFile(destination(homeDir), 'utf8'),
    'rendered grove config',
  );
  const groups = parsed['groups'] as Record<string, Record<string, string>>;
  return groups['TypeScript'] ?? {};
}

const validated: Responder = () => ({ code: 0, stdout: '', stderr: '' });

function rejected(stderr: string): Responder {
  return (): CommandResult => ({ code: 1, stdout: '', stderr });
}

function failure(report: ActivationReport): string | undefined {
  return report.outcomes.find((outcome) => outcome.status === 'failed')?.error;
}

sandboxTest(
  'uses github.com without a per-machine SSH host and is idempotent',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context } = recordingContext({ home: homeDir, respond: validated });

    const first = await runActivation(activation, context);
    const second = await runActivation(activation, context);

    expect(outcomeStatus(first.outcomes)).toBe('changed');
    expect(outcomeStatus(second.outcomes)).toBe('unchanged');
    expect((await lstat(destination(homeDir))).isFile()).toBe(true);
    expect(await repoUrls(homeDir)).toEqual({
      github: 'git@github.com:owner/github.git',
      other: 'git@gitlab.example:owner/other.git',
    });
  },
);

sandboxTest(
  'renders stock GitHub SSH remotes through the configured host',
  async (homeDir) => {
    await deployConfig(homeDir);
    await writeSshHost(homeDir, 'github-work');
    const { context } = recordingContext({ home: homeDir, respond: validated });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('changed');
    expect(await repoUrls(homeDir)).toEqual({
      github: 'git@github-work:owner/github.git',
      other: 'git@gitlab.example:owner/other.git',
    });
  },
);

sandboxTest(
  'validates a candidate beside the destination with the installed gv',
  async (homeDir) => {
    await deployConfig(homeDir);
    let candidate: string | undefined;
    const { context, calls } = recordingContext({
      home: homeDir,
      respond: async (_command, args) => {
        candidate = args[2];
        expect(await readFile(candidate ?? '', 'utf8')).toContain('[groups');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    await runActivation(activation, context);

    expect(
      calls.map(({ command, args }) => [command, args[0], args[1]]),
    ).toEqual([[join(homeDir, '.cargo/bin/gv'), 'validate', '--config']]);
    expect(dirname(candidate ?? '')).toBe(dirname(destination(homeDir)));
    expect(await readdir(dirname(destination(homeDir)))).toEqual([
      'grove.toml',
    ]);
  },
);

sandboxTest(
  'keeps the existing file when gv rejects the rendered config',
  async (homeDir) => {
    await deployConfig(homeDir);
    const first = recordingContext({ home: homeDir, respond: validated });
    await runActivation(activation, first.context);
    const before = await readFile(destination(homeDir), 'utf8');
    await deployConfig(
      homeDir,
      `${CONFIG}added = "git@github.com:owner/added.git"\n`,
    );
    const { context } = recordingContext({
      home: homeDir,
      respond: rejected('unknown field'),
    });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
    expect(failure(report)).toContain('unknown field');
    expect(await readFile(destination(homeDir), 'utf8')).toBe(before);
    expect(await readdir(dirname(destination(homeDir)))).toEqual([
      'grove.toml',
    ]);
  },
);

sandboxTest(
  'replaces a file mev wrote when the asset changes',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context } = recordingContext({ home: homeDir, respond: validated });
    await runActivation(activation, context);
    await deployConfig(
      homeDir,
      `${CONFIG}added = "git@github.com:owner/added.git"\n`,
    );

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('changed');
    expect(await repoUrls(homeDir)).toMatchObject({
      added: 'git@github.com:owner/added.git',
    });
  },
);

sandboxTest(
  'refuses to replace a file edited since mev wrote it',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context, calls } = recordingContext({
      home: homeDir,
      respond: validated,
    });
    await runActivation(activation, context);
    const edited = `${await readFile(destination(homeDir), 'utf8')}local = "git@github.com:owner/local.git"\n`;
    await writeFile(destination(homeDir), edited);
    await deployConfig(
      homeDir,
      `${CONFIG}added = "git@github.com:owner/added.git"\n`,
    );

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
    expect(failure(report)).toContain('differs from what mev last wrote');
    expect(await readFile(destination(homeDir), 'utf8')).toBe(edited);
    expect(calls).toHaveLength(1);
  },
);

sandboxTest(
  'refuses to replace an existing file mev has no record of',
  async (homeDir) => {
    await deployConfig(homeDir);
    await mkdir(dirname(destination(homeDir)), { recursive: true });
    await writeFile(destination(homeDir), 'version = 2\n');
    const { context } = recordingContext({ home: homeDir, respond: validated });

    const report = await runActivation(activation, context);

    expect(outcomeStatus(report.outcomes)).toBe('failed');
    expect(await readFile(destination(homeDir), 'utf8')).toBe('version = 2\n');
  },
);

sandboxTest(
  'adopts an unrecorded file that already matches the rendered config',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context } = recordingContext({ home: homeDir, respond: validated });
    await runActivation(activation, context);
    await unlink(join(homeDir, '.mev/grove/written'));

    const adopted = await runActivation(activation, context);
    await deployConfig(
      homeDir,
      `${CONFIG}added = "git@github.com:owner/added.git"\n`,
    );
    const replaced = await runActivation(activation, context);

    expect(outcomeStatus(adopted.outcomes)).toBe('unchanged');
    expect(outcomeStatus(replaced.outcomes)).toBe('changed');
  },
);

sandboxTest('fails for a malformed stored SSH host', async (homeDir) => {
  await deployConfig(homeDir);
  await mkdir(join(homeDir, '.mev'), { recursive: true });
  await writeFile(join(homeDir, '.mev/ssh-host'), 'git@github.com\n');
  const { context } = recordingContext({ home: homeDir, respond: validated });

  const report = await runActivation(activation, context);

  expect(outcomeStatus(report.outcomes)).toBe('failed');
  expect(failure(report)).toContain('GitHub SSH host');
  await expect(readFile(destination(homeDir))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

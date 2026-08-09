import { expect } from 'bun:test';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deployedPath } from '../../src/assets/ref';
import { writeSshHost } from '../../src/github/ssh-host';
import { home } from '../../src/host/path';
import { loadToml } from '../../src/host/toml';
import { groveConfig, runActivation } from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('mev-grove-config-');
const source = { key: 'grove/grove.toml' };
const activation = groveConfig(source, home('Desktop/grove.toml'));

const CONFIG = `version = 1

[repos.github]
path = "TypeScript/github"
url = "git@github.com:owner/github.git"

[repos.other]
path = "TypeScript/other"
url = "git@gitlab.example:owner/other.git"
`;

async function deployConfig(homeDir: string): Promise<void> {
  const path = deployedPath(source, homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, CONFIG);
}

function destination(homeDir: string): string {
  return join(homeDir, 'Desktop/grove.toml');
}

async function repoUrls(homeDir: string): Promise<Record<string, string>> {
  const parsed = loadToml(
    await readFile(destination(homeDir), 'utf8'),
    'rendered grove config',
  );
  const repos = parsed['repos'] as Record<string, { url: string }>;
  return Object.fromEntries(
    Object.entries(repos).map(([name, repo]) => [name, repo.url]),
  );
}

sandboxTest(
  'uses github.com without a per-machine SSH host and is idempotent',
  async (homeDir) => {
    await deployConfig(homeDir);
    const { context } = recordingContext({ home: homeDir });

    const first = await runActivation(activation, context);
    const second = await runActivation(activation, context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
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
    const { context } = recordingContext({ home: homeDir });

    const report = await runActivation(activation, context);

    expect(report.status).toBe('changed');
    expect(await repoUrls(homeDir)).toEqual({
      github: 'git@github-work:owner/github.git',
      other: 'git@gitlab.example:owner/other.git',
    });
  },
);

sandboxTest('fails for a malformed stored SSH host', async (homeDir) => {
  await deployConfig(homeDir);
  await mkdir(join(homeDir, '.mev'), { recursive: true });
  await writeFile(join(homeDir, '.mev/ssh-host'), 'git@github.com\n');
  const { context } = recordingContext({ home: homeDir });

  const report = await runActivation(activation, context);

  expect(report.status).toBe('failed');
  expect(report.error).toContain('GitHub SSH host');
  await expect(readFile(destination(homeDir))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

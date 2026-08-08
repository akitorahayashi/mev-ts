import { expect } from 'bun:test';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asset } from '../../src/assets/ref';
import { home } from '../../src/host/path';
import { loadToml } from '../../src/host/toml';
import { codexConfig, runActivation } from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const CONFIG_KEY = 'coder/codex/config.toml';

const DECLARED = `model = "gpt-test"

[tui]
theme = "dark"
notifications = false

[[skills.config]]
path = "~/.codex/skills/a/SKILL.md"
enabled = false
`;

const sandboxTest = sandboxedTest('codex-config-');

const activation = () =>
  codexConfig(asset(CONFIG_KEY), home('.codex/config.toml'));

async function deployDeclared(dir: string, content = DECLARED): Promise<void> {
  const role = join(dir, '.mev/roles/coder/codex');
  await mkdir(role, { recursive: true });
  await writeFile(join(role, 'config.toml'), content);
}

function hostConfigPath(dir: string): string {
  return join(dir, '.codex/config.toml');
}

sandboxTest(
  'a missing host file is created from the declared config',
  async (dir) => {
    await deployDeclared(dir);
    const { context } = recordingContext({ home: dir });

    const first = await runActivation(activation(), context);
    const second = await runActivation(activation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const written = loadToml(
      await readFile(hostConfigPath(dir), 'utf8'),
      'host',
    );
    expect(written['model']).toBe('gpt-test');
    expect(written['tui']).toEqual({ theme: 'dark', notifications: false });
  },
);

sandboxTest(
  'declared keys are enforced while codex-owned tables are preserved',
  async (dir) => {
    await deployDeclared(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(
      hostConfigPath(dir),
      [
        'model = "stale"',
        '',
        '[plugins."xlsx@xlsx"]',
        'enabled = true',
        '',
        '[marketplaces.xlsx]',
        'source = "git@github.com:akitorahayashi/xlsx.git"',
        'last_updated = "2026-08-08T04:50:41Z"',
        '',
      ].join('\n'),
    );
    const { context } = recordingContext({ home: dir });

    const first = await runActivation(activation(), context);
    const second = await runActivation(activation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const written = loadToml(
      await readFile(hostConfigPath(dir), 'utf8'),
      'host',
    );
    expect(written['model']).toBe('gpt-test');
    expect(written['plugins']).toEqual({ 'xlsx@xlsx': { enabled: true } });
    expect(written['marketplaces']).toEqual({
      xlsx: {
        source: 'git@github.com:akitorahayashi/xlsx.git',
        last_updated: '2026-08-08T04:50:41Z',
      },
    });
  },
);

sandboxTest(
  'a codex reserialization with equal values is left untouched',
  async (dir) => {
    await deployDeclared(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    // Same values as the declared config, but reordered keys and a comment —
    // the shape codex produces when it rewrites the file wholesale.
    const reserialized = [
      '# rewritten by codex',
      'model = "gpt-test"',
      '',
      '[tui]',
      'notifications = false',
      'theme = "dark"',
      '',
      '[[skills.config]]',
      'path = "~/.codex/skills/a/SKILL.md"',
      'enabled = false',
      '',
    ].join('\n');
    await writeFile(hostConfigPath(dir), reserialized);
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(activation(), context);

    expect(report.status).toBe('unchanged');
    expect(await readFile(hostConfigPath(dir), 'utf8')).toBe(reserialized);
  },
);

sandboxTest(
  'a legacy symlink destination is materialized as a regular file',
  async (dir) => {
    await deployDeclared(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    const storePath = join(dir, '.mev/roles/coder/codex/config.toml');
    await symlink(storePath, hostConfigPath(dir));
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(activation(), context);

    expect(report.status).toBe('changed');
    const stats = await lstat(hostConfigPath(dir));
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isFile()).toBe(true);
    // The deploy store copy stays pristine.
    expect(await readFile(storePath, 'utf8')).toBe(DECLARED);
  },
);

sandboxTest('a declared array replaces host-side additions', async (dir) => {
  await deployDeclared(dir);
  await mkdir(join(dir, '.codex'), { recursive: true });
  await writeFile(
    hostConfigPath(dir),
    [
      'model = "gpt-test"',
      '',
      '[[skills.config]]',
      'path = "~/.codex/skills/a/SKILL.md"',
      'enabled = false',
      '',
      '[[skills.config]]',
      'path = "~/.codex/skills/user-added/SKILL.md"',
      'enabled = true',
      '',
    ].join('\n'),
  );
  const { context } = recordingContext({ home: dir });

  const report = await runActivation(activation(), context);

  expect(report.status).toBe('changed');
  const written = loadToml(await readFile(hostConfigPath(dir), 'utf8'), 'host');
  expect(written['skills']).toEqual({
    config: [{ path: '~/.codex/skills/a/SKILL.md', enabled: false }],
  });
});

sandboxTest(
  'an unparseable host file fails without being overwritten',
  async (dir) => {
    await deployDeclared(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(hostConfigPath(dir), 'model = "unterminated\n');
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(activation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Failed to parse TOML');
    expect(await readFile(hostConfigPath(dir), 'utf8')).toBe(
      'model = "unterminated\n',
    );
  },
);

sandboxTest(
  'a missing deployed config fails with deploy guidance',
  async (dir) => {
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(activation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Codex config');
  },
);

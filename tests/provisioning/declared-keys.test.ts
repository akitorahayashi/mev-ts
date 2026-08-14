import { expect } from 'bun:test';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asset, deployedPath } from '../../src/assets/ref';
import { home } from '../../src/host/path';
import { loadToml } from '../../src/host/toml';
import { declaredKeys, runActivation } from '../../src/provisioning/activation';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('declared-keys-');

const TOML_KEY = 'coder/codex/config.toml';
const JSON_KEY = 'coder/claude/settings.json';

const DECLARED_TOML = `model = "gpt-test"

[tui]
theme = "dark"
notifications = false

[[skills.config]]
path = "~/.codex/skills/a/SKILL.md"
enabled = false
`;

const DECLARED_JSON = `${JSON.stringify(
  {
    cleanupPeriodDays: 20,
    env: { API_TIMEOUT_MS: '600000' },
    permissions: { deny: ['WebFetch'] },
  },
  null,
  2,
)}\n`;

const tomlActivation = () =>
  declaredKeys(asset(TOML_KEY), home('.codex/config.toml'), 'toml');

const jsonActivation = () =>
  declaredKeys(asset(JSON_KEY), home('.claude/settings.json'), 'json');

// The editor settings key doubles as the jsonc fixture: the declared asset is
// strict JSON (a JSONC subset) while the host file may carry comments.
const JSONC_KEY = 'vscode/settings.json';

const DECLARED_JSONC = `${JSON.stringify(
  { 'workbench.colorTheme': 'Light+', 'editor.formatOnSave': true },
  null,
  2,
)}\n`;

const jsoncActivation = () =>
  declaredKeys(
    asset(JSONC_KEY),
    home('Library/Application Support/Code/User/settings.json'),
    'jsonc',
  );

const deployJsonc = (dir: string, content = DECLARED_JSONC) =>
  deploy(dir, JSONC_KEY, content);

const vscodePath = (dir: string) =>
  join(dir, 'Library/Application Support/Code/User/settings.json');

async function deploy(
  dir: string,
  key: string,
  content: string,
): Promise<string> {
  const path = deployedPath({ key }, dir);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
  return path;
}

const deployToml = (dir: string, content = DECLARED_TOML) =>
  deploy(dir, TOML_KEY, content);

const deployJson = (dir: string, content = DECLARED_JSON) =>
  deploy(dir, JSON_KEY, content);

async function writeHost(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

const codexPath = (dir: string) => join(dir, '.codex/config.toml');
const claudePath = (dir: string) => join(dir, '.claude/settings.json');

const readToml = async (path: string) =>
  loadToml(await readFile(path, 'utf8'), 'host');

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8'));

sandboxTest(
  'a missing host file is created from the declared config',
  async (dir) => {
    await deployToml(dir);
    const { context } = recordingContext({ home: dir });

    const first = await runActivation(tomlActivation(), context);
    const second = await runActivation(tomlActivation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const written = await readToml(codexPath(dir));
    expect(written['model']).toBe('gpt-test');
    expect(written['tui']).toEqual({ theme: 'dark', notifications: false });
  },
);

sandboxTest(
  'declared keys are enforced while app-owned tables are preserved',
  async (dir) => {
    await deployToml(dir);
    await writeHost(
      codexPath(dir),
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

    const first = await runActivation(tomlActivation(), context);
    const second = await runActivation(tomlActivation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const written = await readToml(codexPath(dir));
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
  'an app reserialization with equal values is left untouched',
  async (dir) => {
    await deployToml(dir);
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
    await writeHost(codexPath(dir), reserialized);
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(tomlActivation(), context);

    expect(report.status).toBe('unchanged');
    expect(await readFile(codexPath(dir), 'utf8')).toBe(reserialized);
  },
);

sandboxTest(
  'a symlink destination is materialized as a regular file',
  async (dir) => {
    const storePath = await deployToml(dir);
    await mkdir(join(dir, '.codex'), { recursive: true });
    await symlink(storePath, codexPath(dir));
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(tomlActivation(), context);

    expect(report.status).toBe('changed');
    const stats = await lstat(codexPath(dir));
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isFile()).toBe(true);
    // The deploy store copy stays pristine.
    expect(await readFile(storePath, 'utf8')).toBe(DECLARED_TOML);
  },
);

sandboxTest('a declared array replaces host-side additions', async (dir) => {
  await deployToml(dir);
  await writeHost(
    codexPath(dir),
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

  const report = await runActivation(tomlActivation(), context);

  expect(report.status).toBe('changed');
  const written = await readToml(codexPath(dir));
  expect(written['skills']).toEqual({
    config: [{ path: '~/.codex/skills/a/SKILL.md', enabled: false }],
  });
});

sandboxTest(
  'an unparseable host file fails without being overwritten',
  async (dir) => {
    await deployToml(dir);
    await writeHost(codexPath(dir), 'model = "unterminated\n');
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(tomlActivation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Failed to parse TOML');
    expect(await readFile(codexPath(dir), 'utf8')).toBe(
      'model = "unterminated\n',
    );
  },
);

sandboxTest(
  'a missing deployed config fails with deploy guidance',
  async (dir) => {
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(tomlActivation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Declared config');
  },
);

sandboxTest(
  'plugin enablement written by the client survives a declared merge',
  async (dir) => {
    await deployJson(dir);
    await writeHost(
      claudePath(dir),
      `${JSON.stringify(
        {
          cleanupPeriodDays: 1,
          env: { API_TIMEOUT_MS: '1' },
          enabledPlugins: { 'simplify@simplify': true },
          effortLevel: 'xhigh',
        },
        null,
        2,
      )}\n`,
    );
    const { context } = recordingContext({ home: dir });

    const first = await runActivation(jsonActivation(), context);
    const second = await runActivation(jsonActivation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const written = await readJson(claudePath(dir));
    expect(written['cleanupPeriodDays']).toBe(20);
    expect(written['env']).toEqual({ API_TIMEOUT_MS: '600000' });
    expect(written['enabledPlugins']).toEqual({ 'simplify@simplify': true });
    expect(written['effortLevel']).toBe('xhigh');
  },
);

sandboxTest(
  'a symlinked JSON destination is materialized even when the values match',
  async (dir) => {
    const storePath = await deployJson(dir);
    await mkdir(join(dir, '.claude'), { recursive: true });
    await symlink(storePath, claudePath(dir));
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(jsonActivation(), context);

    expect(report.status).toBe('changed');
    const stats = await lstat(claudePath(dir));
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isFile()).toBe(true);
    expect(await readFile(storePath, 'utf8')).toBe(DECLARED_JSON);
  },
);

sandboxTest(
  'an unparseable host JSON file fails without being overwritten',
  async (dir) => {
    await deployJson(dir);
    await writeHost(claudePath(dir), '{ "env": ,}');
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(jsonActivation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('not valid JSON');
    expect(await readFile(claudePath(dir), 'utf8')).toBe('{ "env": ,}');
  },
);

sandboxTest('a JSON host document must be an object', async (dir) => {
  await deployJson(dir);
  await writeHost(claudePath(dir), '["not", "an", "object"]');
  const { context } = recordingContext({ home: dir });

  const report = await runActivation(jsonActivation(), context);

  expect(report.status).toBe('failed');
  expect(report.error).toContain('must be a JSON object');
});

sandboxTest(
  'a jsonc host with comments merges without losing them',
  async (dir) => {
    await deployJsonc(dir);
    await writeHost(
      vscodePath(dir),
      [
        '{',
        '  // theme chosen by hand',
        '  "workbench.colorTheme": "Dark 2026",',
        '  "editor.fontSize": 13, // mine',
        '}',
        '',
      ].join('\n'),
    );
    const { context } = recordingContext({ home: dir });

    const first = await runActivation(jsoncActivation(), context);
    const second = await runActivation(jsoncActivation(), context);

    expect(first.status).toBe('changed');
    expect(second.status).toBe('unchanged');
    const text = await readFile(vscodePath(dir), 'utf8');
    // Declared keys enforced, the app-owned key and both comments intact.
    expect(text).toContain('// theme chosen by hand');
    expect(text).toContain('// mine');
    expect(text).toContain('"workbench.colorTheme": "Light+"');
    expect(text).toContain('"editor.fontSize": 13');
    expect(text).toContain('"editor.formatOnSave": true');
  },
);

sandboxTest(
  'a converged jsonc host with comments is left byte-identical',
  async (dir) => {
    await deployJsonc(dir);
    const converged = [
      '{',
      '  // still here',
      '  "workbench.colorTheme": "Light+",',
      '  "editor.formatOnSave": true,',
      '}',
      '',
    ].join('\n');
    await writeHost(vscodePath(dir), converged);
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(jsoncActivation(), context);

    // Trailing comma and comment are valid JSONC, so the values compare equal
    // and nothing is rewritten.
    expect(report.status).toBe('unchanged');
    expect(await readFile(vscodePath(dir), 'utf8')).toBe(converged);
  },
);

sandboxTest(
  'a malformed jsonc host fails without being overwritten',
  async (dir) => {
    await deployJsonc(dir);
    await writeHost(vscodePath(dir), '{ "a": }');
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(jsoncActivation(), context);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('not valid JSONC');
    expect(await readFile(vscodePath(dir), 'utf8')).toBe('{ "a": }');
  },
);

sandboxTest(
  'a missing jsonc host file is created from the declared config',
  async (dir) => {
    await deployJsonc(dir);
    const { context } = recordingContext({ home: dir });

    const report = await runActivation(jsoncActivation(), context);

    expect(report.status).toBe('changed');
    expect(await readJson(vscodePath(dir))).toEqual({
      'workbench.colorTheme': 'Light+',
      'editor.formatOnSave': true,
    });
  },
);

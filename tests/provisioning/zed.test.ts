import { expect } from 'bun:test';
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asset } from '../../src/assets/ref';
import { embeddedAssets } from '../../src/assets/registry';
import { home } from '../../src/host/path';
import { runActivation, zedSettings } from '../../src/provisioning/activation';
import { runMake } from '../../src/provisioning/run';
import { OVERRIDES_PREFIX } from '../../src/zed/paths';
import { ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('zed-');

async function pathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

const BASE_KEY = 'zed/settings.json';
const BASE_ASSET = asset(BASE_KEY);
const DEST = home('.config/zed/settings.json');

function rolesDir(homeDir: string, key: string): string {
  return join(homeDir, '.mev', 'roles', key);
}

async function deployBase(
  homeDir: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const path = rolesDir(homeDir, BASE_KEY);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(settings));
}

async function deployOverrides(
  homeDir: string,
  overrides: Record<string, Record<string, unknown>>,
): Promise<void> {
  const dir = rolesDir(homeDir, OVERRIDES_PREFIX);
  await mkdir(dir, { recursive: true });
  for (const [name, settings] of Object.entries(overrides)) {
    await writeFile(join(dir, `${name}.json`), JSON.stringify(settings));
  }
}

sandboxTest(
  'zedSettings merges enabled overrides onto the base and symlinks the result',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on', tab_size: 2 });
    await deployOverrides(dir, {
      'no-format': { format_on_save: 'off' },
    });
    const manifestDir = join(dir, '.mev', 'zed');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'overrides-selection.yml'),
      'enabled:\n  - no-format\n',
    );

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('changed');
    const built = join(manifestDir, 'settings.json');
    expect(JSON.parse(await readFile(built, 'utf8'))).toEqual({
      format_on_save: 'off',
      tab_size: 2,
    });
    const link = join(dir, '.config', 'zed', 'settings.json');
    expect(await readlink(link)).toBe(built);
  },
);

sandboxTest(
  'zedSettings fails and names an enabled override missing from the catalog',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on' });
    await deployOverrides(dir, { 'no-format': { format_on_save: 'off' } });
    const manifestDir = join(dir, '.mev', 'zed');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'overrides-selection.yml'),
      'enabled:\n  - ghost\n',
    );

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.entries?.some((e) => e.key === 'ghost')).toBe(true);
    // Validation precedes mutation: a failed activation leaves no built
    // settings.json and no symlink behind.
    expect(await pathPresent(join(manifestDir, 'settings.json'))).toBe(false);
    expect(
      await pathPresent(join(dir, '.config', 'zed', 'settings.json')),
    ).toBe(false);
  },
);

sandboxTest(
  'zedSettings leaves the base untouched when no override is enabled',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on' });
    await deployOverrides(dir, { 'no-format': { format_on_save: 'off' } });

    await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    const built = join(dir, '.mev', 'zed', 'settings.json');
    expect(JSON.parse(await readFile(built, 'utf8'))).toEqual({
      format_on_save: 'on',
    });
  },
);

sandboxTest('zedSettings reports unchanged on a second run', async (dir) => {
  await deployBase(dir, { format_on_save: 'on' });
  await deployOverrides(dir, {});
  const activation = zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST);
  const context = recordingContext({ home: dir }).context;

  await runActivation(activation, context);
  const second = await runActivation(activation, context);

  expect(second.status).toBe('unchanged');
});

sandboxTest(
  'zedSettings fails loudly when two enabled overrides collide on the same key',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on' });
    await deployOverrides(dir, {
      loose: { format_on_save: 'off' },
      strict: { format_on_save: 'on' },
    });
    const manifestDir = join(dir, '.mev', 'zed');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'overrides-selection.yml'),
      'enabled:\n  - loose\n  - strict\n',
    );

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toMatch(/loose.*strict.*format_on_save/);
  },
);

sandboxTest(
  'zedSettings surfaces missing base settings as a provisioning error',
  async (dir) => {
    await deployOverrides(dir, {});

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Zed base settings not found');
  },
);

sandboxTest(
  'zedSettings surfaces a missing overrides source directory',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on' });

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Zed overrides source directory not found');
  },
);

sandboxTest(
  'zedSettings names the file when the base settings contain malformed JSON',
  async (dir) => {
    const path = rolesDir(dir, BASE_KEY);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, '{ not valid json');
    await deployOverrides(dir, {});

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain('Zed base settings at');
    expect(report.error).toContain('is not valid JSON');
  },
);

sandboxTest(
  'zedSettings names the override when an enabled override contains malformed JSON',
  async (dir) => {
    await deployBase(dir, { format_on_save: 'on' });
    const overridesDir = rolesDir(dir, OVERRIDES_PREFIX);
    await mkdir(overridesDir, { recursive: true });
    await writeFile(join(overridesDir, 'broken.json'), '{ not valid json');
    const manifestDir = join(dir, '.mev', 'zed');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'overrides-selection.yml'),
      'enabled:\n  - broken\n',
    );

    const report = await runActivation(
      zedSettings(BASE_ASSET, OVERRIDES_PREFIX, DEST),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toContain("Zed override 'broken' at");
    expect(report.error).toContain('is not valid JSON');
  },
);

sandboxTest(
  'the zed target upgrades through Homebrew and reports the running CLI version',
  async (dir) => {
    let versionProbe = 0;
    const { context, calls } = recordingContext({
      home: dir,
      assets: embeddedAssets,
      basePath: '/usr/bin',
      respond(command, args) {
        if (command === 'zed') return ok('Zed 1.18.1\n');
        if (command !== 'brew') {
          throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        }
        if (args[0] === 'list') return ok('zed\n');
        if (args[0] === 'info') {
          const installed = versionProbe === 0 ? '1.18.0' : '1.18.1';
          versionProbe += 1;
          return ok(JSON.stringify({ casks: [{ token: 'zed', installed }] }));
        }
        if (args[0] === 'upgrade') return ok();
        if (args[0] === '--prefix') return ok('/opt/homebrew\n');
        throw new Error(`Unexpected brew command: ${args.join(' ')}`);
      },
    });

    const report = await runMake(
      { selectors: ['zed'], upgrade: true },
      context,
    );

    expect(report.failed).toBe(false);
    expect(report.install).toEqual([
      {
        token: { kind: 'cask', name: 'zed' },
        status: 'upgraded',
        previousVersions: ['1.18.0'],
        versions: ['1.18.1'],
      },
    ]);
    expect(
      JSON.parse(await readFile(join(dir, '.mev/zed/settings.json'), 'utf8'))[
        'auto_update'
      ],
    ).toBe(false);
    expect(calls).toContainEqual({
      command: 'brew',
      args: ['upgrade', '--no-ask', '--cask', 'zed'],
      options: {},
    });
    expect(calls).toContainEqual({
      command: 'zed',
      args: ['--version'],
      options: { env: { PATH: '/opt/homebrew/bin:/usr/bin' } },
    });
    const zedReport = report.groups
      .find((group) => group.targetName === 'zed')
      ?.reports.find((entry) => entry.description.subject === 'Zed CLI');
    expect(zedReport?.entries).toContainEqual({
      key: 'zed --version',
      value: 'current: Zed 1.18.1',
      status: 'unchanged',
    });
  },
);

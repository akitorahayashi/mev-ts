import { expect } from 'bun:test';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asset } from '../../src/assets/ref';
import { home } from '../../src/host/path';
import { runActivation, zedSettings } from '../../src/provisioning/activation';
import { OVERRIDES_PREFIX } from '../../src/provisioning/zed/paths';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('zed-');

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
    expect(report.error).toContain('Zed overrides source directory is missing');
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
    expect(report.error).toContain(
      'Failed to parse JSON for Zed base settings',
    );
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
    expect(report.error).toContain(
      "Failed to parse JSON for Zed override 'broken'",
    );
  },
);

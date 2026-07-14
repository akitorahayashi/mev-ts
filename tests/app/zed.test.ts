import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SelectEntries } from '../../src/app/config-selection';
import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../src/app/zed';
import { deployedDir } from '../../src/assets/ref';
import { readNameList } from '../../src/provisioning/selection';
import {
  OVERRIDES_PREFIX,
  overridesManifest,
} from '../../src/provisioning/zed/paths';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('app-zed-');

async function deployOverrides(
  home: string,
  names: readonly string[],
): Promise<void> {
  const dir = deployedDir(OVERRIDES_PREFIX, home);
  await mkdir(dir, { recursive: true });
  for (const name of names) {
    await writeFile(join(dir, `${name}.json`), '{}');
  }
}

interface Captured {
  catalog?: readonly string[];
  enabled?: readonly string[];
}

function capturingSelect(chosen: string[] | null): {
  select: SelectEntries;
  seen: Captured;
} {
  const seen: Captured = {};
  const select: SelectEntries = async (_message, catalog, enabled) => {
    seen.catalog = [...catalog];
    seen.enabled = [...enabled];
    return chosen;
  };
  return { select, seen };
}

const collectWarnings = () => {
  const warnings: string[] = [];
  return { warn: (m: string) => warnings.push(m), warnings };
};

sandboxTest(
  'configSelectZedOverrides writes the chosen overrides as the enabled list',
  async (dir) => {
    await deployOverrides(dir, ['aaa', 'bbb', 'ccc']);
    const { select, seen } = capturingSelect(['bbb']);
    const { warn, warnings } = collectWarnings();

    await configSelectZedOverrides(dir, warn, select);

    // Opt-in: nothing is enabled until the user selects it.
    expect(seen.enabled).toEqual([]);
    expect(seen.catalog).toEqual(['aaa', 'bbb', 'ccc']);
    expect(warnings).toEqual([]);
    expect(await readNameList(overridesManifest(dir), 'enabled', 'm')).toEqual([
      'bbb',
    ]);
  },
);

sandboxTest(
  'configSelectZedOverrides warns about enabled names absent from the catalog',
  async (dir) => {
    await deployOverrides(dir, ['aaa']);
    await mkdir(join(dir, '.config', 'mev', 'zed'), { recursive: true });
    await writeFile(overridesManifest(dir), 'enabled:\n  - ghost\n');
    const { select } = capturingSelect(['aaa']);
    const { warn, warnings } = collectWarnings();

    await configSelectZedOverrides(dir, warn, select);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ghost');
  },
);

sandboxTest(
  'configSelectZedOverrides leaves the manifest untouched on cancel',
  async (dir) => {
    await deployOverrides(dir, ['aaa', 'bbb']);
    await mkdir(join(dir, '.config', 'mev', 'zed'), { recursive: true });
    await writeFile(overridesManifest(dir), 'enabled:\n  - aaa\n');
    const { select } = capturingSelect(null);
    const { warn } = collectWarnings();

    await configSelectZedOverrides(dir, warn, select);

    expect(await readNameList(overridesManifest(dir), 'enabled', 'm')).toEqual([
      'aaa',
    ]);
  },
);

sandboxTest(
  'configSelectZedOverridesClear empties the enabled list',
  async (dir) => {
    await deployOverrides(dir, ['aaa', 'bbb']);
    await mkdir(join(dir, '.config', 'mev', 'zed'), { recursive: true });
    await writeFile(overridesManifest(dir), 'enabled:\n  - aaa\n');

    await configSelectZedOverridesClear(dir);

    expect(await readNameList(overridesManifest(dir), 'enabled', 'm')).toEqual(
      [],
    );
  },
);

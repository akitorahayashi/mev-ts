import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSelect, configSelectClear } from '../../src/app/coder';
import type { SelectEntries } from '../../src/app/config-toggle';
import { deployedDir } from '../../src/assets/ref';
import {
  AGENTS_SECTIONS_PREFIX,
  agentsManifest,
  SKILLS_PREFIX,
  skillsManifest,
} from '../../src/coder/paths';
import { readNameList } from '../../src/config-selection/selection';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('app-coder-');

async function deploySections(
  home: string,
  names: readonly string[],
): Promise<void> {
  const dir = deployedDir(AGENTS_SECTIONS_PREFIX, home);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'catalog.yml'),
    `sections:\n${names.map((n) => `  - ${n}`).join('\n')}\n`,
  );
  for (const name of names) {
    await writeFile(join(dir, `${name}.md`), `## ${name}\n`);
  }
}

async function deploySkills(
  home: string,
  names: readonly string[],
): Promise<void> {
  const dir = deployedDir(SKILLS_PREFIX, home);
  for (const name of names) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, 'SKILL.md'), `# ${name}\n`);
  }
}

interface Captured {
  message?: string;
  catalog?: readonly string[];
  enabled?: readonly string[];
}

function capturingSelect(chosen: string[] | null): {
  select: SelectEntries;
  seen: Captured;
} {
  const seen: Captured = {};
  const select: SelectEntries = async (message, catalog, enabled) => {
    seen.message = message;
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
  'configSelect writes the disabled complement of the kept sections',
  async (dir) => {
    await deploySections(dir, ['alpha', 'beta', 'gamma']);
    const { select, seen } = capturingSelect(['alpha']);
    const { warn, warnings } = collectWarnings();

    await configSelect('agents', dir, warn, select);

    expect(seen.enabled).toEqual(['alpha', 'beta', 'gamma']);
    expect(warnings).toEqual([]);
    expect(await readNameList(agentsManifest(dir), 'disabled', 'm')).toEqual([
      'beta',
      'gamma',
    ]);
  },
);

sandboxTest(
  'configSelect warns about manifest names absent from the catalog',
  async (dir) => {
    await deploySections(dir, ['alpha', 'beta']);
    await mkdir(join(dir, '.mev', 'coder'), { recursive: true });
    await writeFile(agentsManifest(dir), 'disabled:\n  - ghost\n');
    const { select, seen } = capturingSelect(['alpha', 'beta']);
    const { warn, warnings } = collectWarnings();

    await configSelect('agents', dir, warn, select);

    expect(seen.enabled).toEqual(['alpha', 'beta']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ghost');
  },
);

sandboxTest(
  'configSelect leaves the manifest untouched on cancel',
  async (dir) => {
    await deploySections(dir, ['alpha', 'beta']);
    await mkdir(join(dir, '.mev', 'coder'), { recursive: true });
    await writeFile(agentsManifest(dir), 'disabled:\n  - beta\n');
    const { select } = capturingSelect(null);
    const { warn } = collectWarnings();

    await configSelect('agents', dir, warn, select);

    expect(await readNameList(agentsManifest(dir), 'disabled', 'm')).toEqual([
      'beta',
    ]);
  },
);

sandboxTest(
  'configSelectClear disables the entire section catalog',
  async (dir) => {
    await deploySections(dir, ['alpha', 'beta', 'gamma']);

    await configSelectClear('agents', dir);

    expect(await readNameList(agentsManifest(dir), 'disabled', 'm')).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  },
);

sandboxTest(
  'configSelect resolves the skills catalog and manifest',
  async (dir) => {
    await deploySkills(dir, ['aaa', 'bbb']);
    const { select, seen } = capturingSelect(['bbb']);
    const { warn } = collectWarnings();

    await configSelect('skills', dir, warn, select);

    expect(seen.catalog).toEqual(['aaa', 'bbb']);
    expect(await readNameList(skillsManifest(dir), 'disabled', 'm')).toEqual([
      'aaa',
    ]);
  },
);

import { expect } from 'bun:test';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { home } from '../../src/host/path';
import {
  coderAgents,
  coderSkills,
  runActivation,
} from '../../src/provisioning/activation';
import { renderAgents } from '../../src/provisioning/coder/agents';
import {
  AGENTS_SECTIONS_PREFIX,
  SKILLS_PREFIX,
} from '../../src/provisioning/coder/paths';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('coder-');

function sourceDir(homeDir: string, prefix: string): string {
  return join(homeDir, '.config', 'mev', 'roles', prefix);
}

async function deploySections(
  homeDir: string,
  catalogYaml: string,
  bodies: Record<string, string>,
): Promise<void> {
  const dir = sourceDir(homeDir, AGENTS_SECTIONS_PREFIX);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'catalog.yml'), catalogYaml);
  for (const [name, body] of Object.entries(bodies)) {
    await writeFile(join(dir, `${name}.md`), body);
  }
}

async function deploySkills(
  homeDir: string,
  names: readonly string[],
): Promise<void> {
  const dir = sourceDir(homeDir, SKILLS_PREFIX);
  for (const name of names) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, 'SKILL.md'), `# ${name}\n`);
  }
}

const AGENTS_DEST = home('.claude/CLAUDE.md');
const SKILLS_TARGET = home('.claude/skills');

sandboxTest(
  'coderAgents concatenates enabled sections and symlinks the result',
  async (dir) => {
    await deploySections(dir, 'sections:\n  - alpha\n  - beta\n', {
      alpha: '## Alpha\n\n- one\n',
      beta: '## Beta\n\n- two\n',
    });

    const report = await runActivation(
      coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('changed');
    const built = join(dir, '.config', 'mev', 'coder', 'AGENTS.md');
    const contents = await readFile(built, 'utf8');
    expect(contents).toContain('## Alpha');
    expect(contents).toContain('## Beta');
    expect(contents.indexOf('## Alpha')).toBeLessThan(
      contents.indexOf('## Beta'),
    );
    const link = join(dir, '.claude', 'CLAUDE.md');
    expect(await readlink(link)).toBe(built);
  },
);

sandboxTest(
  'coderAgents excludes sections disabled in the manifest',
  async (dir) => {
    await deploySections(dir, 'sections:\n  - alpha\n  - beta\n', {
      alpha: '## Alpha\n',
      beta: '## Beta\n',
    });
    const manifestDir = join(dir, '.config', 'mev', 'coder');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'agents-sections.yml'),
      'disabled:\n  - beta\n',
    );

    await runActivation(
      coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
      recordingContext({ home: dir }).context,
    );

    const built = await readFile(join(manifestDir, 'AGENTS.md'), 'utf8');
    expect(built).toContain('## Alpha');
    expect(built).not.toContain('## Beta');
  },
);

sandboxTest('coderAgents reports unchanged on a second run', async (dir) => {
  await deploySections(dir, 'sections:\n  - alpha\n', {
    alpha: '## Alpha\n',
  });
  const activation = coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]);
  const context = recordingContext({ home: dir }).context;

  await runActivation(activation, context);
  const second = await runActivation(activation, context);

  expect(second.status).toBe('unchanged');
});

sandboxTest(
  'coderAgents surfaces a stale disabled manifest entry as unchanged',
  async (dir) => {
    await deploySections(dir, 'sections:\n  - alpha\n', {
      alpha: '## Alpha\n',
    });
    const manifestDir = join(dir, '.config', 'mev', 'coder');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'agents-sections.yml'),
      'disabled:\n  - ghost\n',
    );

    const report = await runActivation(
      coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).not.toBe('failed');
    const ghost = report.entries?.find((e) => e.key === 'ghost');
    expect(ghost?.status).toBe('unchanged');
  },
);

sandboxTest('coderAgents surfaces manifest filesystem errors', async (dir) => {
  await deploySections(dir, 'sections:\n  - alpha\n', {
    alpha: '## Alpha\n',
  });
  await mkdir(join(dir, '.config', 'mev'), { recursive: true });
  await writeFile(join(dir, '.config', 'mev', 'coder'), 'not a directory');

  const report = await runActivation(
    coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
    recordingContext({ home: dir }).context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toMatch(/not a directory/i);
});

sandboxTest(
  'coderAgents surfaces deployed catalog filesystem errors',
  async (dir) => {
    const parent = join(dir, '.config', 'mev', 'roles', 'coder', 'global');
    await mkdir(join(parent, '..'), { recursive: true });
    await writeFile(parent, 'not a directory');

    const report = await runActivation(
      coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toMatch(/not a directory/i);
  },
);

sandboxTest('coderAgents rejects non-string catalog sections', async (dir) => {
  await deploySections(dir, 'sections:\n  - 42\n', {});

  const report = await runActivation(
    coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
    recordingContext({ home: dir }).context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toContain('sections sequence of strings');
});

sandboxTest('coderAgents surfaces generated file read errors', async (dir) => {
  await deploySections(dir, 'sections:\n  - alpha\n', {
    alpha: '## Alpha\n',
  });
  const generatedParent = join(dir, '.config', 'mev', 'coder');
  await mkdir(generatedParent, { recursive: true });
  await mkdir(join(generatedParent, 'AGENTS.md'));

  const report = await runActivation(
    coderAgents(AGENTS_SECTIONS_PREFIX, [AGENTS_DEST]),
    recordingContext({ home: dir }).context,
  );

  expect(report.status).toBe('failed');
  expect(report.error).toMatch(/illegal operation|is a directory/i);
});

sandboxTest(
  'coderSkills links each enabled skill into the target via the intermediate',
  async (dir) => {
    await deploySkills(dir, ['toon', 'task-doc']);

    const report = await runActivation(
      coderSkills(SKILLS_PREFIX, [SKILLS_TARGET]),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('changed');
    const intermediate = join(dir, '.config', 'mev', 'coder', 'skills', 'toon');
    expect(await readlink(intermediate)).toBe(
      join(sourceDir(dir, SKILLS_PREFIX), 'toon'),
    );
    const targetLink = join(dir, '.claude', 'skills', 'task-doc');
    expect(await readlink(targetLink)).toBe(
      join(dir, '.config', 'mev', 'coder', 'skills', 'task-doc'),
    );
  },
);

sandboxTest(
  'coderSkills removes a target link when its skill is disabled',
  async (dir) => {
    await deploySkills(dir, ['toon']);
    const manifestDir = join(dir, '.config', 'mev', 'coder');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'skills-selection.yml'),
      'disabled:\n  - toon\n',
    );

    await runActivation(
      coderSkills(SKILLS_PREFIX, [SKILLS_TARGET]),
      recordingContext({ home: dir }).context,
    );

    const targetLink = join(dir, '.claude', 'skills', 'toon');
    expect(await lstat(targetLink).catch(() => null)).toBeNull();
  },
);

sandboxTest(
  'coderSkills leaves an unmanaged target entry untouched',
  async (dir) => {
    await deploySkills(dir, ['toon']);
    const targetDir = join(dir, '.claude', 'skills');
    await mkdir(targetDir, { recursive: true });
    // An unmanaged symlink not pointing into the intermediate must survive.
    const foreign = join(dir, 'foreign');
    await writeFile(foreign, 'x');
    await symlink(foreign, join(targetDir, 'mine'));

    await runActivation(
      coderSkills(SKILLS_PREFIX, [SKILLS_TARGET]),
      recordingContext({ home: dir }).context,
    );

    expect(await readlink(join(targetDir, 'mine'))).toBe(foreign);
  },
);

sandboxTest(
  'coderSkills surfaces target directory filesystem errors',
  async (dir) => {
    await deploySkills(dir, ['toon']);
    await writeFile(join(dir, '.claude'), 'not a directory');

    const report = await runActivation(
      coderSkills(SKILLS_PREFIX, [SKILLS_TARGET]),
      recordingContext({ home: dir }).context,
    );

    expect(report.status).toBe('failed');
    expect(report.error).toMatch(/not a directory/i);
  },
);

sandboxTest(
  'renderAgents surfaces a missing section file as a labeled error',
  async (dir) => {
    const sourceDir = join(dir, 'sections');
    await mkdir(sourceDir, { recursive: true });

    await expect(renderAgents(sourceDir, ['ghost'])).rejects.toThrow(
      /section 'ghost' not found/,
    );
  },
);

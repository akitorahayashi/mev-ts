import { expect } from 'bun:test';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSelect, configSelectClear } from '../../src/app/coder';
import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../src/app/zed';
import { asset } from '../../src/assets/ref';
import {
  AGENTS_SECTIONS_PREFIX,
  agentsManifest,
  SKILLS_PREFIX,
} from '../../src/coder/paths';
import { home } from '../../src/host/path';
import {
  coderAgents,
  coderSkills,
  runActivation,
  zedSettings,
} from '../../src/provisioning/activation';
import {
  appliedPath,
  readApplied,
  writeApplied,
} from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { resolveTarget } from '../../src/provisioning/registry';
import { scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { OVERRIDES_PREFIX } from '../../src/zed/paths';
import { mapAssetSource } from '../fixtures/asset-source';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('selection-sync-');
const assets = mapAssetSource({
  [`${AGENTS_SECTIONS_PREFIX}/catalog.yml`]: 'sections:\n  - alpha\n  - beta\n',
  [`${AGENTS_SECTIONS_PREFIX}/alpha.md`]: '# Alpha\n',
  [`${AGENTS_SECTIONS_PREFIX}/beta.md`]: '# Beta\n',
  [`${SKILLS_PREFIX}/alpha/SKILL.md`]: '# Alpha\n',
  [`${SKILLS_PREFIX}/beta/SKILL.md`]: '# Beta\n',
  'zed/settings.json': '{"tab_size":2}',
  [`${OVERRIDES_PREFIX}/wide.json`]: '{"tab_size":4}',
});
const targets = [resolveTarget('coder'), resolveTarget('zed')];

async function prepare(directory: string) {
  const { context } = recordingContext({ home: directory, assets });
  for (const target of targets) {
    await deployRole(target.role, context);
    await writeApplied(
      appliedPath(directory, target.name),
      await targetSignature(target, assets),
    );
  }
  return context;
}

for (const surface of ['agents', 'skills', 'zed'] as const) {
  sandboxTest(
    `${surface} changes select only the owner and regenerate selected output`,
    async (directory) => {
      const context = await prepare(directory);
      const owner = resolveTarget(surface === 'zed' ? 'zed' : 'coder');
      const choose = async () => (surface === 'zed' ? ['wide'] : ['alpha']);
      if (surface === 'zed')
        await configSelectZedOverrides(directory, () => {}, choose);
      else await configSelect(surface, directory, () => {}, choose);
      const scans = await scanTargets(targets, context);
      expect(
        scans.map((scan) => ('reasons' in scan ? scan.reasons : scan.error)),
      ).toEqual(surface === 'zed' ? [[], ['unapplied']] : [['unapplied'], []]);

      const activation =
        surface === 'agents'
          ? coderAgents(AGENTS_SECTIONS_PREFIX, [home('.claude/CLAUDE.md')])
          : surface === 'skills'
            ? coderSkills(SKILLS_PREFIX, [home('.agents/skills')])
            : zedSettings(
                asset('zed/settings.json'),
                OVERRIDES_PREFIX,
                home('.config/zed/settings.json'),
              );
      const report = await runActivation(activation, context);
      expect(
        report.outcomes.every(
          (outcome) =>
            outcome.status !== 'failed' && outcome.status !== 'blocked',
        ),
      ).toBe(true);
      if (surface === 'agents') {
        const instructions = await readFile(
          join(directory, '.claude/CLAUDE.md'),
          'utf8',
        );
        expect(instructions).toContain('# Alpha');
        expect(instructions).not.toContain('# Beta');
      } else if (surface === 'skills') {
        expect(await readdir(join(directory, '.agents/skills'))).toEqual([
          'alpha',
        ]);
      } else {
        expect(
          JSON.parse(
            await readFile(
              join(directory, '.config/zed/settings.json'),
              'utf8',
            ),
          ),
        ).toEqual({ tab_size: 4 });
      }
      await writeApplied(
        appliedPath(directory, owner.name),
        await targetSignature(owner, assets),
      );
      expect(await scanTargets(targets, context)).toEqual(
        targets.map((target) => ({ target, reasons: [] })),
      );

      if (surface === 'zed') await configSelectZedOverridesClear(directory);
      else await configSelectClear(surface, directory);
      expect(await readApplied(appliedPath(directory, owner.name))).toBeNull();
    },
  );

  sandboxTest(
    `${surface} cancellation and reordered unchanged choices retain applied state`,
    async (directory) => {
      await prepare(directory);
      const unchanged = surface === 'zed' ? [] : ['beta', 'alpha'];
      for (const chosen of [null, unchanged]) {
        if (surface === 'zed')
          await configSelectZedOverrides(
            directory,
            () => {},
            async () => chosen,
          );
        else
          await configSelect(
            surface,
            directory,
            () => {},
            async () => chosen,
          );
        for (const target of targets) {
          expect(await readApplied(appliedPath(directory, target.name))).toBe(
            await targetSignature(target, assets),
          );
        }
      }
    },
  );
}

sandboxTest(
  'invalidation failure leaves the selection manifest untouched',
  async (directory) => {
    await prepare(directory);
    const marker = appliedPath(directory, 'coder');
    // A directory is not an unlinkable marker and fails without relying on chmod/root behavior.
    await unlink(marker);
    await mkdir(marker);
    await expect(configSelectClear('agents', directory)).rejects.toThrow(
      'Failed to invalidate',
    );
    await expect(readFile(agentsManifest(directory))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  },
);

sandboxTest(
  'manifest write failure leaves the owning target safely stale',
  async (directory) => {
    await prepare(directory);
    await mkdir(join(directory, '.mev/coder'), { recursive: true });
    await writeFile(agentsManifest(directory), 'disabled: []\n');
    await expect(
      configSelect(
        'agents',
        directory,
        () => {},
        async () => {
          await unlink(agentsManifest(directory));
          await mkdir(agentsManifest(directory));
          return [];
        },
      ),
    ).rejects.toThrow('Failed to write');
    expect(await readApplied(appliedPath(directory, 'coder'))).toBeNull();
  },
);

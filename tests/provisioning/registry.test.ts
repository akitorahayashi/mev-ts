import { expect, test } from 'bun:test';
import { embeddedAssets } from '../../src/assets/registry';
import {
  allTargets,
  availableSelectors,
  resolveTarget,
} from '../../src/provisioning/registry';

// Target-agnostic invariants: every registered target must reference only
// embedded assets and own a distinct set of selectors. Adding a target is
// covered automatically.

test('every activation references an asset that exists in the registry', async () => {
  for (const t of allTargets()) {
    for (const activation of t.activations) {
      if (activation.kind === 'file') {
        await expect(
          embeddedAssets.read(activation.source.key),
        ).resolves.toBeString();
      } else if (activation.kind === 'defaults') {
        await expect(
          embeddedAssets.read(activation.configKey),
        ).resolves.toBeString();
      } else if (activation.kind === 'duti') {
        await expect(
          embeddedAssets.read(activation.configKey),
        ).resolves.toBeString();
      } else if (activation.kind === 'pipx') {
        await expect(
          embeddedAssets.read(activation.configKey),
        ).resolves.toBeString();
      } else if (activation.kind === 'editorExtensions') {
        await expect(
          embeddedAssets.read(activation.configKey),
        ).resolves.toBeString();
      } else if (activation.kind === 'coderAgents') {
        expect(
          embeddedAssets.keysByPrefix(activation.sectionsPrefix).length,
        ).toBeGreaterThan(0);
      } else if (activation.kind === 'coderSkills') {
        expect(
          embeddedAssets.keysByPrefix(activation.skillsPrefix).length,
        ).toBeGreaterThan(0);
      } else if (activation.kind === 'command') {
        for (const key of Object.values(activation.reads ?? {})) {
          await expect(embeddedAssets.read(key)).resolves.toBeString();
        }
      } else {
        expect(
          embeddedAssets.keysByPrefix(activation.prefix).length,
        ).toBeGreaterThan(0);
      }
    }
  }
});

test('every target deploys assets or installs packages', () => {
  for (const t of allTargets()) {
    const assetCount = embeddedAssets.keysByPrefix(`${t.role}/`).length;
    const packageCount =
      t.packages.taps.length +
      t.packages.formulae.length +
      t.packages.casks.length;
    expect(assetCount + packageCount).toBeGreaterThan(0);
  }
});

test('no tag or alias is shared between targets', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

test('an alias resolves to its owning target', () => {
  expect(resolveTarget('sh')).toBe(resolveTarget('shell'));
});

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
      } else {
        expect(
          embeddedAssets.keysByPrefix(activation.prefix).length,
        ).toBeGreaterThan(0);
      }
    }
  }
});

test('every target deploys a role with at least one embedded asset', () => {
  for (const t of allTargets()) {
    expect(embeddedAssets.keysByPrefix(`${t.role}/`).length).toBeGreaterThan(0);
  }
});

test('no tag or alias is shared between targets', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

test('an alias resolves to its owning target', () => {
  expect(resolveTarget('sh')).toBe(resolveTarget('shell'));
});

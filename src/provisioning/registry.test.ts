import { expect, test } from 'bun:test';
import { embeddedAssets } from '../assets/registry';
import { manifestName } from '../brew/manifest';
import type { Activation, AssetReference } from './activation/contract';
import { handlerFor } from './activation/kinds';
import { planMake } from './plan';
import {
  allTargets,
  availableSelectors,
  fullSetupTargets,
  resolveTarget,
} from './registry';

// Target-agnostic invariants: every registered target must reference only
// embedded assets and own a distinct set of selectors. Adding a target is
// covered automatically.

/**
 * The assets an activation references come from the same per-kind registry the
 * engine dispatches through, so this invariant cannot fall out of step with a
 * newly added kind: the registry's mapped type already refuses to compile
 * without one.
 */
function referencedAssets(activation: Activation): readonly AssetReference[] {
  return handlerFor(activation).references(activation);
}

test('every activation references an existing asset under its own role', async () => {
  for (const t of allTargets()) {
    for (const activation of t.activations) {
      for (const reference of referencedAssets(activation)) {
        if ('key' in reference) {
          await expect(
            embeddedAssets.read(reference.key),
          ).resolves.toBeString();
          expect(reference.key.startsWith(`${t.role}/`)).toBe(true);
        } else {
          expect(
            embeddedAssets.keysByPrefix(reference.prefix).length,
          ).toBeGreaterThan(0);
          expect(reference.prefix.startsWith(`${t.role}/`)).toBe(true);
        }
      }
    }
  }
});

// A role Brewfile declares packages; an activation that also consumed it would
// apply or link the declaration as configuration.
test('no activation consumes its role Brewfile', () => {
  const consumers: string[] = [];
  for (const t of allTargets()) {
    const brewfile = `${t.role}/${manifestName}`;
    for (const activation of t.activations) {
      for (const reference of referencedAssets(activation)) {
        const consumed =
          'key' in reference
            ? reference.key === brewfile
            : brewfile.startsWith(reference.prefix);
        if (consumed) consumers.push(`${t.name}: ${activation.kind}`);
      }
    }
  }
  expect(consumers).toEqual([]);
});

test('every target deploys assets or runs activations', () => {
  for (const t of allTargets()) {
    const assetCount = embeddedAssets.keysByPrefix(`${t.role}/`).length;
    expect(assetCount + t.activations.length).toBeGreaterThan(0);
  }
});

test('every embedded role Brewfile is a valid declaration', async () => {
  await expect(
    planMake(
      allTargets().map((t) => t.name),
      embeddedAssets,
    ),
  ).resolves.toBeDefined();
});

test('every embedded asset key belongs to a role directory', () => {
  for (const key of embeddedAssets.keysByPrefix('')) {
    expect(key).toMatch(/^[^/]+\/.+/);
    expect(key.split('/')).not.toContain('global');
  }
});

test('no target name or alias is shared between targets', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

// Deploy-store pruning compares only the top level of ~/.mev/roles.
test('every deployed role is a single directory owned by one target', () => {
  const roles = allTargets().map((target) => target.role);
  expect(new Set(roles).size).toBe(roles.length);
  expect(roles.filter((role) => role.includes('/'))).toEqual([]);
});

test('an alias resolves to its owning target', () => {
  expect(resolveTarget('sh')).toBe(resolveTarget('shell'));
});

test('the full-setup selection is every non-optional target', () => {
  const full = fullSetupTargets();
  expect(full).toEqual(allTargets().filter((t) => !t.optional));
  expect(full.every((t) => !t.optional)).toBe(true);
  expect(full).not.toContain(resolveTarget('casks'));
});

import { expect, test } from 'bun:test';
import { embeddedAssets } from '../assets/registry';
import type { Activation } from './activation/contract';
import {
  allTargets,
  availableSelectors,
  fullSetupTargets,
  resolveTarget,
} from './registry';

// Target-agnostic invariants: every registered target must reference only
// embedded assets and own a distinct set of selectors. Adding a target is
// covered automatically.

/** An asset an activation reads: a single key, or every key under a prefix. */
type AssetReference = { readonly key: string } | { readonly prefix: string };

/**
 * The assets an activation references. A `switch` over the discriminated union
 * with an exhaustiveness check, so adding a new `Activation` kind without
 * teaching this test its references is a compile error rather than a silent
 * gap.
 */
function referencedAssets(activation: Activation): AssetReference[] {
  switch (activation.kind) {
    case 'file':
      return [{ key: activation.source.key }];
    case 'tree':
      return [{ prefix: activation.prefix }];
    case 'defaults':
    case 'duti':
    case 'pipx':
    case 'editorExtensions':
    case 'release':
      return [{ key: activation.configKey }];
    case 'coderAgents':
      return [{ prefix: activation.sectionsPrefix }];
    case 'coderSkills':
      return [{ prefix: activation.skillsPrefix }];
    case 'zedSettings':
      return [
        { key: activation.base.key },
        { prefix: activation.overridesPrefix },
      ];
    case 'command':
      return Object.values(activation.reads ?? {}).map((key) => ({ key }));
    default:
      return assertNever(activation);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled activation kind: ${JSON.stringify(value)}`);
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

test('every target deploys assets, installs packages, or runs activations', () => {
  for (const t of allTargets()) {
    const assetCount = embeddedAssets.keysByPrefix(`${t.role}/`).length;
    const packageCount =
      t.packages.taps.length +
      t.packages.formulae.length +
      t.packages.casks.length;
    expect(assetCount + packageCount + t.activations.length).toBeGreaterThan(0);
  }
});

test('every embedded asset key belongs to a role global directory', () => {
  for (const key of embeddedAssets.keysByPrefix('')) {
    expect(key).toMatch(/^[^/]+\/global\//);
  }
});

test('no tag or alias is shared between targets', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

test('an alias resolves to its owning target', () => {
  expect(resolveTarget('sh')).toBe(resolveTarget('shell'));
});

test('the full-setup selection is every non-optional target', () => {
  const full = fullSetupTargets();
  expect(full).toEqual(allTargets().filter((t) => !t.optional));
  expect(full.every((t) => !t.optional)).toBe(true);
  expect(full).not.toContain(resolveTarget('cask'));
});

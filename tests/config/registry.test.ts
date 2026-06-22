import { expect, test } from 'bun:test';
import { embeddedAssets } from '../../src/mev/assets/registry';
import { allFeatures, availableSelectors } from '../../src/mev/config/registry';
import { buildGraph } from '../../src/mev/resources/graph';

// Feature-agnostic invariants: every registered feature must form a valid graph
// and reference only embedded assets. Adding a feature is covered automatically.

test('every feature normalizes into a valid graph', () => {
  for (const feature of allFeatures()) {
    expect(() => buildGraph(feature.resources)).not.toThrow();
  }
});

test('every referenced asset exists in the embedded registry', async () => {
  for (const feature of allFeatures()) {
    for (const resource of feature.resources) {
      const match = resource.id.match(/^fs:asset:(.+)$/);
      if (!match?.[1]) {
        continue;
      }
      await expect(embeddedAssets.read(match[1])).resolves.toBeString();
    }
  }
});

test('no tag or alias is shared between features', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

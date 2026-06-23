import { expect, test } from 'bun:test';
import { embeddedAssets } from '../../src/assets/registry';
import { allTargets, availableSelectors } from '../../src/config/registry';
import { buildGraph } from '../../src/resources/graph';

// Target-agnostic invariants: every registered target must form a valid graph
// and reference only embedded assets. Adding a target is covered automatically.

test('every target normalizes into a valid graph', () => {
  for (const t of allTargets()) {
    expect(() => buildGraph(t.resources)).not.toThrow();
  }
});

test('every referenced asset exists in the embedded registry', async () => {
  for (const t of allTargets()) {
    for (const resource of t.resources) {
      const match = resource.id.match(/^fs:asset:(.+)$/);
      if (!match?.[1]) {
        continue;
      }
      await expect(embeddedAssets.read(match[1])).resolves.toBeString();
    }
  }
});

test('no tag or alias is shared between targets', () => {
  const selectors = availableSelectors();
  expect(new Set(selectors).size).toBe(selectors.length);
});

import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../src/errors';
import { buildGraph } from '../../src/resources/graph';
import type { Resource } from '../../src/resources/model';

function stub(id: string, dependencies: string[] = []): Resource {
  return {
    id,
    dependencies,
    concurrencyGroup: 'filesystem',
    async inspect() {
      return { kind: 'present' };
    },
    async apply() {
      return {};
    },
  };
}

test('collapses resources that share an id to a single node', () => {
  const graph = buildGraph([
    stub('fs:directory:~/a'),
    stub('fs:directory:~/a'),
  ]);
  expect(graph.resources).toHaveLength(1);
});

test('rejects a dependency on an undeclared resource', () => {
  expect(() => buildGraph([stub('a', ['missing'])])).toThrow(ProvisioningError);
});

test('rejects a dependency cycle', () => {
  expect(() => buildGraph([stub('a', ['b']), stub('b', ['a'])])).toThrow(
    ProvisioningError,
  );
});

test('accepts an acyclic dependency chain', () => {
  const graph = buildGraph([stub('a'), stub('b', ['a']), stub('c', ['b'])]);
  expect(graph.resources).toHaveLength(3);
});

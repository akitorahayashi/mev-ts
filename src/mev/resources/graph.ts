import { ProvisioningError } from '../errors';
import type { Resource } from './model';

export interface ResourceGraph {
  /** Resources in dependency order (dependencies precede their dependents). */
  readonly resources: readonly Resource[];
  readonly byId: ReadonlyMap<string, Resource>;
}

/**
 * Normalizes a resource selection into an executable graph: identical ids are
 * collapsed to one node, every declared dependency must exist, dependency cycles
 * are rejected, and the result is topologically sorted via Kahn's algorithm.
 */
export function buildGraph(selected: readonly Resource[]): ResourceGraph {
  const byId = new Map<string, Resource>();
  for (const resource of selected) {
    if (!byId.has(resource.id)) {
      byId.set(resource.id, resource);
    }
  }

  for (const resource of byId.values()) {
    for (const dep of resource.dependencies) {
      if (!byId.has(dep)) {
        throw new ProvisioningError(
          `Resource '${resource.id}' depends on unknown resource '${dep}'.`,
        );
      }
    }
  }

  const resources = kahn([...byId.values()]);
  return { resources, byId };
}

function kahn(nodes: Resource[]): Resource[] {
  const inDegree = new Map<string, number>(
    nodes.map((n) => [n.id, n.dependencies.length]),
  );

  const queue = nodes.filter((n) => inDegree.get(n.id) === 0);
  const sorted: Resource[] = [];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    sorted.push(node);

    for (const dependent of nodes) {
      if (!dependent.dependencies.includes(node.id)) continue;
      const remaining = (inDegree.get(dependent.id) ?? 1) - 1;
      inDegree.set(dependent.id, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new ProvisioningError('Dependency cycle detected.');
  }

  return sorted;
}

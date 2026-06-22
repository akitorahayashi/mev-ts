import pLimit from 'p-limit';
import type { ResourceGraph } from './graph';
import {
  type ConcurrencyGroup,
  type Context,
  concurrencyGroups,
  type Outcome,
  type ResourceReport,
} from './model';

type Limits = Record<ConcurrencyGroup, ReturnType<typeof pLimit>>;

function makeLimits(): Limits {
  return Object.fromEntries(
    Object.entries(concurrencyGroups).map(([group, limit]) => [
      group,
      pLimit(limit),
    ]),
  ) as Limits;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function make(
  id: string,
  outcome: Outcome,
  extras: { detail?: string; error?: string } = {},
): ResourceReport {
  return { id, outcome, ...extras };
}

/** Inspect every resource and report what `apply` would change, without applying. */
export async function planGraph(
  graph: ResourceGraph,
  context: Context,
): Promise<ResourceReport[]> {
  return Promise.all(
    graph.resources.map(async (resource) => {
      try {
        const state = await resource.inspect(context);
        const outcome = state.kind === 'present' ? 'unchanged' : 'changed';
        return make(resource.id, outcome, { detail: state.detail });
      } catch (error) {
        return make(resource.id, 'failed', { error: errorMessage(error) });
      }
    }),
  );
}

/**
 * Inspect every resource, then apply only those that diverge from desired state.
 * Resources execute in dependency order; each waits for its dependencies via Promise
 * composition. Per-group concurrency limits are enforced by p-limit instances.
 * A resource whose dependency failed or was blocked is itself blocked.
 */
export async function applyGraph(
  graph: ResourceGraph,
  context: Context,
): Promise<ResourceReport[]> {
  const limits = makeLimits();
  const outcomes = new Map<string, Promise<ResourceReport>>();

  for (const resource of graph.resources) {
    const depPromises = resource.dependencies.map((id) => {
      const p = outcomes.get(id);
      if (!p)
        throw new Error(
          `Dependency '${id}' not resolved — graph is not topologically sorted.`,
        );
      return p;
    });

    outcomes.set(
      resource.id,
      limits[resource.concurrencyGroup](async () => {
        const deps = await Promise.all(depPromises);
        if (
          deps.some((r) => r.outcome === 'failed' || r.outcome === 'blocked')
        ) {
          return make(resource.id, 'blocked');
        }
        try {
          const state = await resource.inspect(context);
          if (state.kind === 'present') {
            return make(resource.id, 'unchanged', { detail: state.detail });
          }
          const result = await resource.apply(context);
          return make(resource.id, 'changed', { detail: result.detail });
        } catch (error) {
          return make(resource.id, 'failed', { error: errorMessage(error) });
        }
      }),
    );
  }

  return Promise.all(
    graph.resources.map((r) => {
      const p = outcomes.get(r.id);
      if (!p) throw new Error(`Resource '${r.id}' has no outcome.`);
      return p;
    }),
  );
}

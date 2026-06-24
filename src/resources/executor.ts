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
  resource: { id: string; display?: string },
  outcome: Outcome,
  extras: { detail?: string; error?: string } = {},
): ResourceReport {
  return {
    id: resource.id,
    ...(resource.display !== undefined ? { display: resource.display } : {}),
    outcome,
    ...extras,
  };
}

/** Inspect every resource and report what `apply` would change, without applying. */
export async function planGraph(
  graph: ResourceGraph,
  context: Context,
  onProgress?: (report: ResourceReport) => void,
): Promise<ResourceReport[]> {
  return Promise.all(
    graph.resources.map(async (resource) => {
      try {
        const state = await resource.inspect(context);
        const outcome = state.kind === 'present' ? 'unchanged' : 'changed';
        const report = make(resource, outcome, { detail: state.detail });
        onProgress?.(report);
        return report;
      } catch (error) {
        const report = make(resource, 'failed', {
          error: errorMessage(error),
        });
        onProgress?.(report);
        return report;
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
  onProgress?: (report: ResourceReport) => void,
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

    // Resolve dependencies outside the concurrency group so waiting tasks do
    // not hold a slot while their dependencies (potentially in another group)
    // are still running.
    const promise = (async () => {
      const deps = await Promise.all(depPromises);
      if (deps.some((r) => r.outcome === 'failed' || r.outcome === 'blocked')) {
        const report = make(resource, 'blocked');
        onProgress?.(report);
        return report;
      }
      return limits[resource.concurrencyGroup](async () => {
        try {
          const state = await resource.inspect(context);
          if (state.kind === 'present') {
            const report = make(resource, 'unchanged', {
              detail: state.detail,
            });
            onProgress?.(report);
            return report;
          }
          const result = await resource.apply(context);
          const report = make(resource, 'changed', {
            detail: result.detail,
          });
          onProgress?.(report);
          return report;
        } catch (error) {
          const report = make(resource, 'failed', {
            error: errorMessage(error),
          });
          onProgress?.(report);
          return report;
        }
      });
    })();
    outcomes.set(resource.id, promise);
  }

  return Promise.all(
    graph.resources.map((r) => {
      const p = outcomes.get(r.id);
      if (!p) throw new Error(`Resource '${r.id}' has no outcome.`);
      return p;
    }),
  );
}

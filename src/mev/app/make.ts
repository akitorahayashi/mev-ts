import { resolveTarget } from '../config/registry';
import { renderReports } from '../output/report';
import { applyGraph, planGraph } from '../resources/executor';
import { buildGraph } from '../resources/graph';
import type { Context, Resource } from '../resources/model';
import { createContext } from '../runtime/context';

export interface MakeRequest {
  readonly tags: readonly string[];
  readonly plan: boolean;
  readonly overwrite: boolean;
}

export interface MakeResult {
  readonly report: string;
  readonly failed: boolean;
}

/**
 * Resolve the selected tags to targets, normalize their resources into a
 * graph, and either plan or apply it against the live host.
 */
export async function runMake(
  request: MakeRequest,
  context: Context = createContext({ overwrite: request.overwrite }),
): Promise<MakeResult> {
  const selected: Resource[] = request.tags.flatMap(
    (tag) => resolveTarget(tag).resources,
  );
  const graph = buildGraph(selected);

  const reports = request.plan
    ? await planGraph(graph, context)
    : await applyGraph(graph, context);

  return {
    report: renderReports(reports, { plan: request.plan }),
    failed: reports.some((report) => report.outcome === 'failed'),
  };
}

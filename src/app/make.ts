import { resolveTarget } from '../config/registry';
import { applyGraph, planGraph } from '../resources/executor';
import { buildGraph } from '../resources/graph';
import type { Context, Resource, ResourceReport } from '../resources/model';
import { createContext } from '../runtime/context';

export interface MakeRequest {
  readonly tags: readonly string[];
  readonly plan: boolean;
  readonly overwrite: boolean;
  readonly onStart?: (total: number) => void;
  readonly onProgress?: (report: ResourceReport) => void;
}

export interface MakeResult {
  readonly reports: readonly ResourceReport[];
  readonly failed: boolean;
}

export async function runMake(
  request: MakeRequest,
  context: Context = createContext({ overwrite: request.overwrite }),
): Promise<MakeResult> {
  const selected: Resource[] = request.tags.flatMap(
    (tag) => resolveTarget(tag).resources,
  );
  const graph = buildGraph(selected);

  request.onStart?.(graph.resources.length);

  const reports = request.plan
    ? await planGraph(graph, context, request.onProgress)
    : await applyGraph(graph, context, request.onProgress);

  return {
    reports,
    failed: reports.some((report) => report.outcome === 'failed'),
  };
}

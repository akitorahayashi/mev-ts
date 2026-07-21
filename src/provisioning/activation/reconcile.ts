import { errorMessage } from '../../errors';
import { mapWithConcurrency } from '../../host/task-pool';
import type {
  ActivationReport,
  ActivationStatus,
  Described,
  StepReport,
} from './contract';

/**
 * The per-activation error boundary shared by the hand-rolled runners. Runs
 * `fn` and, if it throws, renders the failure as a `failed` report over `base`,
 * so the boundary is structural instead of copied into every runner's `catch`.
 */
export async function guarded(
  base: Described,
  fn: () => Promise<ActivationReport>,
): Promise<ActivationReport> {
  try {
    return await fn();
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

/**
 * Fold per-item step statuses into an activation status: any failure fails,
 * else any change is changed, else unchanged. For entry-status aggregation only
 * — not for runners that combine local boolean flags.
 */
export function aggregateStatus(
  entries: readonly StepReport[],
): Extract<ActivationStatus, 'changed' | 'unchanged' | 'failed'> {
  if (entries.some((entry) => entry.status === 'failed')) return 'failed';
  if (entries.some((entry) => entry.status === 'changed')) return 'changed';
  return 'unchanged';
}

/**
 * One reconciled item. `run` is the normal path—probe, act, return its report.
 * `onError` renders the item's failure when `run` throws, as a closure over the
 * item so it can name the item and reflect any partial actions already taken.
 */
export interface ReconcileStep {
  run(): Promise<StepReport>;
  onError(error: unknown): StepReport;
}

/**
 * The kind-specific half of a reconciliation. `declare` parses what the target
 * asked for. `steps` runs the shared probes and builds the per-item steps;
 * anything it throws before returning the list is a whole-activation failure.
 * `concurrent` selects a bounded parallel loop; kinds default to serial and set
 * it only when the per-item work is IO-bound and independent (currently just
 * `release`, whose items are network downloads).
 */
export interface ReconcileSpec<D> {
  declare(): Promise<readonly D[]>;
  steps(declared: readonly D[]): Promise<readonly ReconcileStep[]>;
  concurrent?: number;
}

async function executeStep(step: ReconcileStep): Promise<StepReport> {
  try {
    return await step.run();
  } catch (error) {
    return step.onError(error);
  }
}

async function runSeries(
  steps: readonly ReconcileStep[],
): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  for (const step of steps) {
    reports.push(await executeStep(step));
  }
  return reports;
}

/**
 * The reconcile envelope shared by the list-into-report kinds. It owns the
 * per-item loop, status derivation, and—through `executeStep`—the per-item error
 * boundary, so one item's failure becomes a `failed` `StepReport` that neither
 * rejects the batch nor aborts its siblings rather than relying on each kind to
 * place that boundary by convention. Concurrent runs report in declaration
 * order because `Promise.all` preserves it. An empty declaration is `unchanged`
 * because there is nothing to apply. A failure from `declare` or from `steps`
 * before it returns the list is a whole-activation error.
 */
export async function reconcile<D>(
  base: Described,
  spec: ReconcileSpec<D>,
): Promise<ActivationReport> {
  try {
    const declared = await spec.declare();
    if (declared.length === 0) {
      return { ...base, status: 'unchanged', entries: [] };
    }
    const steps = await spec.steps(declared);
    const entries =
      spec.concurrent && spec.concurrent > 1
        ? await mapWithConcurrency(steps, spec.concurrent, executeStep)
        : await runSeries(steps);
    return { ...base, status: aggregateStatus(entries), entries };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

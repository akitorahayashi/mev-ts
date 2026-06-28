import {
  type ActivationReport,
  type Described,
  errorMessage,
  type StepReport,
} from './contract';

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
 * `concurrent` selects `Promise.all` over a sequential loop.
 */
export interface ReconcileSpec<D> {
  declare(): Promise<readonly D[]>;
  steps(declared: readonly D[]): Promise<readonly ReconcileStep[]>;
  concurrent?: boolean;
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
    const entries = spec.concurrent
      ? await Promise.all(steps.map(executeStep))
      : await runSeries(steps);
    const failed = entries.some((entry) => entry.status === 'failed');
    const changed = entries.some((entry) => entry.status === 'changed');
    const status = failed ? 'failed' : changed ? 'changed' : 'unchanged';
    return { ...base, status, entries };
  } catch (error) {
    return { ...base, status: 'failed', error: errorMessage(error) };
  }
}

import { errorMessage } from '../../errors';
import { mapWithConcurrency } from '../../host/task-pool';
import { outcomeStatus, type ResourceOutcome } from '../resource-outcome';
import type {
  ActivationDescription,
  ActivationReport,
  ReconcileItemResult,
} from './contract';

export function stepOutcome(step: ReconcileItemResult): ResourceOutcome {
  const details = step.value ? [step.value] : undefined;
  if (step.status === 'failed') {
    return {
      label: step.key,
      status: 'failed',
      error: step.error ?? 'Unknown error.',
      details,
    };
  }
  return { label: step.key, status: step.status, details };
}

export function activationReport(
  description: ActivationDescription,
  outcomes: readonly ResourceOutcome[],
  notices?: readonly string[],
): ActivationReport {
  const status = outcomeStatus(outcomes);
  const entries: ReconcileItemResult[] = outcomes.flatMap((outcome) => {
    if (outcome.status === 'blocked') return [];
    return [
      {
        key: outcome.label,
        value: outcome.details?.join(', ') ?? '',
        status: outcome.status,
        ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
      },
    ];
  });
  return {
    description,
    outcomes,
    ...(notices && notices.length > 0 ? { notices } : {}),
    status,
    entries,
  };
}

export function aggregateStatus(
  entries: readonly ReconcileItemResult[],
): ReturnType<typeof outcomeStatus> {
  return outcomeStatus(entries.map(stepOutcome));
}

interface GuardedResult {
  readonly status: 'changed' | 'unchanged' | 'applied' | 'failed' | 'blocked';
  readonly entries?: readonly ReconcileItemResult[];
  readonly error?: string;
}

/**
 * The per-activation error boundary shared by the hand-rolled runners. Runs
 * `fn` and, if it throws, renders the failure as a `failed` report over `base`,
 * so the boundary is structural instead of copied into every runner's `catch`.
 */
export async function guarded(
  description: ActivationDescription,
  fn: () => Promise<ActivationReport | GuardedResult>,
): Promise<ActivationReport> {
  try {
    const result = await fn();
    if ('outcomes' in result) return result;
    if (result.entries) {
      return activationReport(description, result.entries.map(stepOutcome));
    }
    if (result.status === 'failed') {
      const error = result.error ?? 'Unknown error.';
      return {
        ...activationReport(description, [
          { label: description.subject, status: 'failed', error },
        ]),
        error,
      };
    }
    if (result.status === 'blocked') {
      const error = result.error ?? 'A prerequisite was not satisfied.';
      return {
        ...activationReport(description, [
          { label: description.subject, status: 'blocked', reason: error },
        ]),
        error,
        entries: undefined,
      };
    }
    return activationReport(description, [
      { label: description.subject, status: result.status },
    ]);
  } catch (error) {
    const message = errorMessage(error);
    return {
      ...activationReport(description, [
        { label: description.subject, status: 'failed', error: message },
      ]),
      error: message,
    };
  }
}

/**
 * One reconciled item. `run` is the normal path—probe, act, return its report.
 * `onError` renders the item's failure when `run` throws, as a closure over the
 * item so it can name the item and reflect any partial actions already taken.
 */
export interface ReconcileStep {
  run(): Promise<ReconcileItemResult>;
  onError(error: unknown): ReconcileItemResult;
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

async function executeStep(step: ReconcileStep): Promise<ReconcileItemResult> {
  try {
    return await step.run();
  } catch (error) {
    return step.onError(error);
  }
}

async function runSeries(
  steps: readonly ReconcileStep[],
): Promise<ReconcileItemResult[]> {
  const reports: ReconcileItemResult[] = [];
  for (const step of steps) {
    reports.push(await executeStep(step));
  }
  return reports;
}

/**
 * The reconcile envelope shared by the list-into-report kinds. It owns the
 * per-item loop, status derivation, and—through `executeStep`—the per-item error
 * boundary, so one item's failure becomes a failed item result that neither
 * rejects the batch nor aborts its siblings rather than relying on each kind to
 * place that boundary by convention. Concurrent runs report in declaration
 * order because `Promise.all` preserves it. An empty declaration is `unchanged`
 * because there is nothing to apply. A failure from `declare` or from `steps`
 * before it returns the list is a whole-activation error.
 */
export async function reconcile<D>(
  description: ActivationDescription,
  spec: ReconcileSpec<D>,
): Promise<ActivationReport> {
  try {
    const declared = await spec.declare();
    if (declared.length === 0) {
      return activationReport(description, []);
    }
    const steps = await spec.steps(declared);
    const entries =
      spec.concurrent && spec.concurrent > 1
        ? await mapWithConcurrency(steps, spec.concurrent, executeStep)
        : await runSeries(steps);
    return activationReport(description, entries.map(stepOutcome));
  } catch (error) {
    const message = errorMessage(error);
    return {
      ...activationReport(description, [
        { label: description.subject, status: 'failed', error: message },
      ]),
      error: message,
    };
  }
}

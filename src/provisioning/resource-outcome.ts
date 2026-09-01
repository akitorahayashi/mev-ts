export const OUTCOME_STATUSES = [
  'changed',
  'applied',
  'unchanged',
  'failed',
  'blocked',
] as const;

export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

interface SuccessfulOutcome {
  readonly label: string;
  readonly details?: readonly string[];
}

export type ResourceOutcome =
  | (SuccessfulOutcome & {
      readonly status: 'changed' | 'unchanged' | 'applied';
    })
  | {
      readonly label: string;
      readonly status: 'failed';
      readonly error: string;
      readonly details?: readonly string[];
    }
  | {
      readonly label: string;
      readonly status: 'blocked';
      readonly reason: string;
    };

export function outcomeStatus(
  outcomes: readonly ResourceOutcome[],
): OutcomeStatus {
  if (outcomes.some((outcome) => outcome.status === 'failed')) return 'failed';
  if (outcomes.some((outcome) => outcome.status === 'blocked')) {
    return 'blocked';
  }
  if (outcomes.some((outcome) => outcome.status === 'changed')) {
    return 'changed';
  }
  if (outcomes.some((outcome) => outcome.status === 'applied')) {
    return 'applied';
  }
  return 'unchanged';
}

export function outcomeSucceeded(status: OutcomeStatus): boolean {
  return status === 'changed' || status === 'unchanged' || status === 'applied';
}

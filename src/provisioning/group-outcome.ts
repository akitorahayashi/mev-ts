import type { ActivationDescription } from './activation';
import {
  type OutcomeStatus,
  outcomeStatus,
  outcomeSucceeded,
} from './resource-outcome';
import type { ActivationGroupReport } from './run';

/**
 * The report-model reduction of one activation group: "what happened" to a
 * target, independent of how it is rendered.
 */
export type GroupStatus = OutcomeStatus;

export function activationLine(report: ActivationDescription): string {
  return report.subject;
}

export function groupStatus(group: ActivationGroupReport): GroupStatus {
  if (group.markerError !== undefined) return 'failed';
  if (group.blockers.length > 0) return 'blocked';
  return outcomeStatus(group.reports.flatMap((report) => report.outcomes));
}

/**
 * Whether a target came through provisioning intact. Defined on `groupStatus`
 * rather than re-reducing the same fields, so the exit code, the applied-marker
 * decision, and the rendered status can never disagree about one target.
 */
export function groupSucceeded(group: ActivationGroupReport): boolean {
  return outcomeSucceeded(groupStatus(group));
}

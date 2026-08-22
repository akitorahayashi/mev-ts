import type { ActivationReport, Described, Verb } from './activation';
import type { ActivationGroupReport } from './run';

/**
 * The report-model reduction of one activation group: "what happened" to a
 * target, independent of how it is rendered. The TTY layer consumes a status
 * and a one-line summary and only decides how they look.
 */
export const GROUP_STATUSES = [
  'changed',
  'unchanged',
  'failed',
  'blocked',
] as const;

export type GroupStatus = (typeof GROUP_STATUSES)[number];

export function activationLine(report: Described): string {
  return `${report.verb} ${report.source} -> ${report.dest}`;
}

export function groupStatus(group: ActivationGroupReport): GroupStatus {
  if (
    group.blockers.length > 0 ||
    group.reports.some((report) => report.status === 'blocked')
  ) {
    return 'blocked';
  }
  if (
    group.reports.some((report) => report.status === 'failed') ||
    group.markerError !== undefined
  ) {
    return 'failed';
  }
  if (group.reports.some((report) => report.status === 'changed')) {
    return 'changed';
  }
  return 'unchanged';
}

/**
 * Whether a target came through provisioning intact. Defined on `groupStatus`
 * rather than re-reducing the same fields, so the exit code, the applied-marker
 * decision, and the rendered status can never disagree about one target.
 */
export function groupSucceeded(group: ActivationGroupReport): boolean {
  const status = groupStatus(group);
  return status === 'changed' || status === 'unchanged';
}

function pastTense(verb: Verb): string {
  switch (verb) {
    case 'link':
      return 'linked';
    case 'apply':
      return 'applied';
    case 'run':
      return 'ran';
  }
}

function countChanged(report: ActivationReport): number {
  if (!report.entries) return report.status === 'changed' ? 1 : 0;
  return report.entries.filter((entry) => entry.status === 'changed').length;
}

function changedSummary(group: ActivationGroupReport): string | null {
  const counts = new Map<Verb, number>();
  for (const report of group.reports) {
    const count = countChanged(report);
    if (count === 0) continue;
    counts.set(report.verb, (counts.get(report.verb) ?? 0) + count);
  }

  const parts: string[] = [];
  for (const verb of ['link', 'apply', 'run'] as const) {
    const count = counts.get(verb);
    if (count) parts.push(`${count} ${pastTense(verb)}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function failedSummary(group: ActivationGroupReport): string | null {
  const failed = group.reports.find((report) => report.status === 'failed');
  if (failed) return activationLine(failed);
  if (group.markerError !== undefined) return 'applied marker not recorded';
  return null;
}

function blockedSummary(group: ActivationGroupReport): string | null {
  if (group.blockers.length === 0) {
    const blocked = group.reports.find((report) => report.status === 'blocked');
    return blocked ? activationLine(blocked) : null;
  }
  if (group.blockers.length > 1) return 'prerequisites failed';
  const blocker = group.blockers[0];
  if (!blocker) return null;
  if (blocker.kind === 'deploy') return `deploy role ${blocker.role} failed`;
  return `${blocker.token.kind} ${blocker.token.name} failed`;
}

export function summarizeGroup(group: ActivationGroupReport): string | null {
  switch (groupStatus(group)) {
    case 'changed':
      return changedSummary(group);
    case 'failed':
      return failedSummary(group);
    case 'blocked':
      return blockedSummary(group);
    case 'unchanged':
      return null;
  }
}

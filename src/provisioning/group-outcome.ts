import type { ActivationReport, Described, Verb } from './activation';
import type { ActivationGroupReport } from './run';

/**
 * The report-model reduction of one activation group: "what happened" to a
 * target, independent of how it is rendered. The TTY layer consumes a status
 * and a one-line summary and only decides how they look.
 */
export type GroupStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

/** The canonical one-line description of a single activation. */
export function activationLine(report: Described): string {
  return `${report.verb} ${report.source} -> ${report.dest}`;
}

export function groupStatus(group: ActivationGroupReport): GroupStatus {
  if (group.blockers.length > 0) return 'blocked';
  if (group.reports.some((report) => report.status === 'failed')) {
    return 'failed';
  }
  if (group.reports.some((report) => report.status === 'changed')) {
    return 'changed';
  }
  return 'unchanged';
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
  return failed ? activationLine(failed) : null;
}

function blockedSummary(group: ActivationGroupReport): string | null {
  if (group.blockers.length === 0) return null;
  if (group.blockers.length > 1) return 'prerequisites failed';
  const blocker = group.blockers[0];
  if (!blocker) return null;
  if (blocker.kind === 'deploy') return `deploy role ${blocker.role} failed`;
  return `${blocker.token.kind} ${blocker.token.name} failed`;
}

/** A one-line summary of the group's outcome, or null when nothing changed. */
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

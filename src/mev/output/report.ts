import type { Outcome, ResourceReport } from '../resources/model';

const planLabels: Record<Outcome, string> = {
  unchanged: 'unchanged',
  changed: 'to change',
  failed: 'failed',
  blocked: 'blocked',
};

const applyLabels: Record<Outcome, string> = {
  unchanged: 'unchanged',
  changed: 'changed',
  failed: 'failed',
  blocked: 'blocked',
};

interface RenderOptions {
  readonly plan: boolean;
}

/** Render execution reports as aligned per-resource lines plus a summary. */
export function renderReports(
  reports: readonly ResourceReport[],
  options: RenderOptions,
): string {
  const labels = options.plan ? planLabels : applyLabels;
  const width = reports.reduce(
    (max, report) => Math.max(max, report.id.length),
    0,
  );

  const lines = reports.map((report) => {
    const label = labels[report.outcome];
    const suffix = report.error ?? report.detail;
    const tail = suffix ? `  (${suffix})` : '';
    return `  ${report.id.padEnd(width)}  ${label}${tail}`;
  });

  const counts = new Map<Outcome, number>();
  for (const report of reports) {
    counts.set(report.outcome, (counts.get(report.outcome) ?? 0) + 1);
  }
  const summary = (['changed', 'unchanged', 'blocked', 'failed'] as const)
    .filter((outcome) => counts.has(outcome))
    .map((outcome) => `${counts.get(outcome)} ${labels[outcome]}`)
    .join(', ');

  return [...lines, summary].join('\n');
}

import type { Outcome, ResourceReport } from '../../resources/model';
import { makeStyle } from './style';

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
  readonly isTTY?: boolean;
}

export function renderReports(
  reports: readonly ResourceReport[],
  options: RenderOptions,
): string {
  const isTTY = options.isTTY ?? process.stdout.isTTY ?? false;
  const c = makeStyle(isTTY);
  const labels = options.plan ? planLabels : applyLabels;
  const width = reports.reduce(
    (max, report) => Math.max(max, report.id.length),
    0,
  );

  const colorLabel = (outcome: Outcome, text: string): string => {
    if (!isTTY) return text;
    if (outcome === 'changed') return c.green(text);
    if (outcome === 'failed') return c.red(text);
    if (outcome === 'blocked') return c.yellow(text);
    return c.dim(text);
  };

  const lines = reports.map((report) => {
    const label = colorLabel(report.outcome, labels[report.outcome]);
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

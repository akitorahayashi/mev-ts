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

function isAsset(r: ResourceReport): boolean {
  return r.id.startsWith('fs:asset:');
}

function renderGroup(reports: ResourceReport[], header: string): string {
  const withAnnotation = (r: ResourceReport): string => {
    const label = r.display ?? r.id;
    return r.error ? `${label}  (${r.error})` : label;
  };

  const itemLines = reports.map((r) => `  ${withAnnotation(r)}`);

  return [header, ...itemLines].join('\n');
}

export function renderOutcomes(
  reports: readonly ResourceReport[],
  options: RenderOptions,
): string {
  const isTTY = options.isTTY ?? process.stdout.isTTY ?? false;
  const c = makeStyle(isTTY);
  const labels = options.plan ? planLabels : applyLabels;

  const colorHeader = (outcome: Outcome, text: string): string => {
    if (!isTTY) return text;
    if (outcome === 'changed') return c.green(text);
    if (outcome === 'failed') return c.red(text);
    if (outcome === 'blocked') return c.yellow(text);
    return c.dim(text);
  };

  const sections: string[] = [];

  for (const outcome of ['failed', 'blocked', 'changed'] as const) {
    const group = reports.filter(
      (r) => r.outcome === outcome && r.display !== undefined && !isAsset(r),
    );
    if (group.length > 0) {
      sections.push(
        renderGroup(
          group,
          colorHeader(outcome, `${labels[outcome]}  (${group.length})`),
        ),
      );
    }

    if (outcome === 'changed') {
      const deployed = reports.filter(
        (r) => r.outcome === 'changed' && isAsset(r),
      );
      if (deployed.length > 0) {
        sections.push(
          renderGroup(
            deployed,
            isTTY
              ? c.dim(`deployed  (${deployed.length})`)
              : `deployed  (${deployed.length})`,
          ),
        );
      }
    }
  }

  const unchangedCount = reports.filter(
    (r) => r.outcome === 'unchanged' && r.display !== undefined && !isAsset(r),
  ).length;
  if (unchangedCount > 0) {
    sections.push(c.dim(`${unchangedCount} ${labels.unchanged}`));
  }

  return sections.join('\n\n');
}

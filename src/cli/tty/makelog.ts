import type {
  ActivationReport,
  DefaultsEntryReport,
} from '../../provisioning/activation';
import type { DeployResult } from '../../provisioning/deploy';
import type { MakePlan } from '../../provisioning/plan';
import type { ActivationGroupReport } from '../../provisioning/run';
import { makeStyle } from './style';

interface RenderOptions {
  readonly plan: boolean;
  readonly isTTY?: boolean;
}

export function renderDeployLine(
  result: DeployResult,
  plan: boolean,
  isTTY = process.stdout.isTTY ?? false,
): string | null {
  if (!result.deployed) {
    return null;
  }
  const c = makeStyle(isTTY);
  const verb = plan ? 'Would deploy config for' : 'Deployed config for';
  const suffix = result.files.length > 0 ? `  ${result.files.join('  ')}` : '';
  return c.dim(`  ${verb} ${result.role}${suffix}`);
}

/** The `Running tags` / `Required …` header block. */
export function renderHeader(selection: MakePlan): string {
  const lines = [`Running tags: ${selection.tags.join(', ')}`];
  const { taps, formulae, casks } = selection.packages;
  if (taps.length > 0) lines.push(`Required taps: ${taps.join(', ')}`);
  if (formulae.length > 0)
    lines.push(`Required formulae: ${formulae.join(', ')}`);
  if (casks.length > 0) lines.push(`Required casks: ${casks.join(', ')}`);
  return lines.join('\n');
}

function isAllUnchanged(group: ActivationGroupReport): boolean {
  return (
    !group.blocked &&
    group.reports.length > 0 &&
    group.reports.every((r) => r.status === 'unchanged')
  );
}

export function renderGroups(
  groups: readonly ActivationGroupReport[],
  options: RenderOptions,
): string {
  const isTTY = options.isTTY ?? process.stdout.isTTY ?? false;
  const c = makeStyle(isTTY);

  const quietTags = groups.filter(isAllUnchanged).map((g) => g.tag);
  const tagPad = quietTags.reduce((w, tag) => Math.max(w, tag.length), 0);

  const verbCol = (report: ActivationReport): string =>
    c.dim(report.verb.padEnd(4));

  const arrow = c.dim('→');

  const renderEntries = (entries: readonly DefaultsEntryReport[]): string[] => {
    const keyPad = entries.reduce((w, e) => Math.max(w, e.key.length), 0);
    return entries.map((e) => {
      const line = `      ${e.key.padEnd(keyPad)}  ${arrow}  ${e.value}`;
      return e.status === 'failed' ? c.red(`${line}  (${e.error})`) : line;
    });
  };

  const renderActive = (reports: readonly ActivationReport[]): string[] => {
    const plainReports = reports.filter((r) => !r.entries);
    const srcPad = plainReports.reduce(
      (w, r) => Math.max(w, r.source.length),
      0,
    );
    return reports.flatMap((r) => {
      if (r.entries) {
        const header = `  ${verbCol(r)}  ${r.source}`;
        const headerLine =
          r.status === 'blocked' ? c.yellow(`${header}  (blocked)`) : header;
        return [headerLine, ...renderEntries(r.entries)];
      }
      const body = `  ${verbCol(r)}  ${r.source.padEnd(srcPad)}  ${arrow}  ${r.dest}`;
      if (r.status === 'failed') return [c.red(`${body}  (${r.error})`)];
      if (r.status === 'blocked') return [c.yellow(`${body}  (blocked)`)];
      return [body];
    });
  };

  const blocks: string[] = [];
  for (const group of groups) {
    if (isAllUnchanged(group)) {
      const label = group.tag.padEnd(tagPad);
      blocks.push(c.dim(`${label}  ${group.reports.length} unchanged`));
      continue;
    }

    const active = group.reports.filter((r) => r.status !== 'unchanged');
    const unchanged = group.reports.length - active.length;
    const header = group.blocked ? c.yellow(group.tag) : c.bold(group.tag);
    const lines = [header, ...renderActive(active)];
    if (unchanged > 0) {
      lines.push(c.dim(`  ${unchanged} unchanged`));
    }
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

export function renderSuccess(isTTY = process.stdout.isTTY ?? false): string {
  return makeStyle(isTTY).green('✓ Completed successfully!');
}

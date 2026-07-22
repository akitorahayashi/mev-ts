import type { ActivationReport } from '../../provisioning/activation';
import type { DeployResult } from '../../provisioning/deploy';
import {
  activationLine,
  type GroupStatus,
  groupStatus,
  summarizeGroup,
} from '../../provisioning/group-outcome';
import type { MakePlan } from '../../provisioning/plan';
import {
  type ActivationGroupReport,
  formatBlocker,
  type MakeReport,
} from '../../provisioning/run';
import { makeStyle } from './style';

interface RenderOptions {
  readonly isTTY: boolean;
  /** Width to pad target names to, for aligned completion columns. */
  readonly nameWidth?: number;
}

interface ReportOptions {
  readonly isTTY: boolean;
  readonly durationMs?: number;
  readonly footer?: readonly string[];
}

// The widest status word, so the summary column aligns after the status regardless
// of which status a target ended in.
const STATUS_WIDTH = Math.max(
  ...(
    ['changed', 'unchanged', 'failed', 'blocked'] satisfies GroupStatus[]
  ).map((status) => status.length),
);

export function renderDeployLine(
  result: DeployResult,
  isTTY: boolean,
): string | null {
  if (!result.deployed) {
    return null;
  }
  const c = makeStyle(isTTY);
  const suffix = result.files.length > 0 ? `  ${result.files.join('  ')}` : '';
  return c.dim(`  Deployed config for ${result.role}${suffix}`);
}

/** The `Running targets` / `Required ...` header block. */
export function renderHeader(selection: MakePlan): string {
  const lines = [`Running targets: ${selection.targetNames.join(', ')}`];
  const { taps, formulae, casks } = selection.packages;
  if (taps.length > 0) lines.push(`Required taps: ${taps.join(', ')}`);
  if (formulae.length > 0)
    lines.push(`Required formulae: ${formulae.join(', ')}`);
  if (casks.length > 0) lines.push(`Required casks: ${casks.join(', ')}`);
  return lines.join('\n');
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds === 0) return '<1s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}m${rest}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = String(minutes % 60).padStart(2, '0');
  return `${hours}h${minuteRest}m${rest}s`;
}

export function renderTargetCompletionLine(
  group: ActivationGroupReport,
  options: RenderOptions,
): string {
  const status = groupStatus(group);
  const summary = summarizeGroup(group);
  if (!options.isTTY) {
    const line = `${group.targetName}: ${status}`;
    return summary ? `${line}  ${summary}` : line;
  }

  const c = makeStyle(options.isTTY);
  const prefix =
    status === 'failed'
      ? c.red('✗')
      : status === 'blocked'
        ? c.yellow('!')
        : c.green('✓');
  const statusText =
    status === 'failed'
      ? c.red(status)
      : status === 'blocked'
        ? c.yellow(status)
        : status === 'unchanged'
          ? c.dim(status)
          : c.green(status);
  // Pad the name to the widest target name in the batch (measured on the raw
  // cell, as table.ts does) so summaries line up regardless of name length.
  const nameWidth = Math.max(options.nameWidth ?? 0, group.targetName.length);
  const body = `${prefix} ${group.targetName.padEnd(nameWidth)}  ${statusText}`;
  if (!summary) return body;
  const statusPad = ' '.repeat(Math.max(0, STATUS_WIDTH - status.length));
  return `${body}${statusPad}  ${summary}`;
}

function failedEntryLines(report: ActivationReport): string[] {
  const failedEntries =
    report.entries?.filter((entry) => entry.status === 'failed') ?? [];
  if (failedEntries.length === 0) {
    return report.error ? [`   ${report.error}`] : [];
  }
  return failedEntries.map(
    (entry) => `   ${entry.key}: ${entry.error ?? entry.value}`,
  );
}

/** Classify a blocked group's action-required title by its blocker cause. */
function blockerTitle(group: ActivationGroupReport): string {
  const [only] = group.blockers;
  if (group.blockers.length === 1 && only?.kind === 'package') {
    return `${group.targetName} blocked by failed package`;
  }
  if (group.blockers.length === 1 && only?.kind === 'deploy') {
    return `${group.targetName} blocked by deploy failure`;
  }
  return `${group.targetName} blocked by prerequisite failures`;
}

/** The numbered "Action required" entries: blockers, failed activations, and
 * unrecorded markers, each as a titled block with detail lines. */
function actionRequiredLines(
  groups: readonly ActivationGroupReport[],
): string[] {
  const lines: string[] = [];
  let number = 0;
  const entry = (title: string, detail: readonly string[]) => {
    number += 1;
    lines.push(`${number}. ${title}`, ...detail, '');
  };
  for (const group of groups) {
    if (group.blockers.length > 0) {
      entry(
        blockerTitle(group),
        group.blockers.map((blocker) => `   ${formatBlocker(blocker)}`),
      );
    }
    for (const activation of group.reports) {
      if (activation.status !== 'failed') continue;
      entry(`${group.targetName} failed during activation`, [
        `   ${activationLine(activation)}`,
        ...failedEntryLines(activation),
      ]);
    }
    if (group.markerError) {
      entry(
        `${group.targetName} activated but its applied marker was not recorded`,
        [`   ${group.markerError}`],
      );
    }
  }
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The targets a retry should re-run: any blocked, failed, or unrecorded group. */
function retryTargets(groups: readonly ActivationGroupReport[]): string[] {
  return groups
    .filter(
      (group) =>
        group.blockers.length > 0 ||
        group.reports.some((activation) => activation.status === 'failed') ||
        group.markerError !== undefined,
    )
    .map((group) => group.targetName);
}

export function renderMakeReport(
  report: MakeReport,
  options: ReportOptions,
): string {
  const c = makeStyle(options.isTTY);
  const result = report.failed ? 'failed' : 'success';
  const resultText = result === 'failed' ? c.red(result) : c.green(result);

  const lines = ['mev report', `Result: ${resultText}`];
  const duration = formatDuration(options.durationMs);
  if (duration) lines.push(`Duration: ${duration}`);
  lines.push('Mode: apply');

  const actionLines = actionRequiredLines(report.groups);
  if (actionLines.length > 0) {
    lines.push('', 'Action required', ...actionLines);
  }

  const retry = retryTargets(report.groups);
  if (retry.length > 0) {
    lines.push('', 'Retry', `mev make ${retry.join(' ')}`);
  }

  if (options.footer && options.footer.length > 0) {
    lines.push('', ...options.footer);
  }

  return lines.join('\n');
}

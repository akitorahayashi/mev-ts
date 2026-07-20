import type {
  ActivationReport,
  Described,
  Verb,
} from '../../provisioning/activation';
import type { DeployResult } from '../../provisioning/deploy';
import type { MakePlan } from '../../provisioning/plan';
import {
  type ActivationGroupReport,
  type ActivationStartEvent,
  formatBlocker,
  type MakeReport,
} from '../../provisioning/run';
import { makeStyle } from './style';

interface RenderOptions {
  readonly isTTY: boolean;
}

interface ReportOptions extends RenderOptions {
  readonly durationMs?: number;
  readonly footer?: readonly string[];
}

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

function isBlocked(group: ActivationGroupReport): boolean {
  return group.blockers.length > 0;
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

function activationLine(report: Described): string {
  return `${report.verb} ${report.source} -> ${report.dest}`;
}

export function renderActivationDescription(activation: Described): string {
  return activationLine(activation);
}

export function renderActivationStartLine(event: ActivationStartEvent): string {
  return `${event.targetName}  ${renderActivationDescription(event.activation)}`;
}

type TargetStatus = 'changed' | 'unchanged' | 'failed' | 'blocked';

function targetStatus(group: ActivationGroupReport): TargetStatus {
  if (isBlocked(group)) return 'blocked';
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

export function summarizeActivationGroup(
  group: ActivationGroupReport,
): string | null {
  switch (targetStatus(group)) {
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

export function renderTargetCompletionLine(
  group: ActivationGroupReport,
  options: RenderOptions,
): string {
  const status = targetStatus(group);
  const summary = summarizeActivationGroup(group);
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
  const plainBody = `✓ ${group.targetName.padEnd(7)}  ${status}`;
  const body = `${prefix} ${group.targetName.padEnd(7)}  ${statusText}`;
  const padding = summary ? ' '.repeat(Math.max(0, 22 - plainBody.length)) : '';
  return summary ? `${body}${padding}  ${summary}` : body;
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

  const actionLines: string[] = [];
  let actionNumber = 0;
  for (const group of report.groups) {
    if (isBlocked(group)) {
      actionNumber += 1;
      const title =
        group.blockers.length === 1 && group.blockers[0]?.kind === 'package'
          ? `${group.targetName} blocked by failed package`
          : group.blockers.length === 1 && group.blockers[0]?.kind === 'deploy'
            ? `${group.targetName} blocked by deploy failure`
            : `${group.targetName} blocked by prerequisite failures`;
      actionLines.push(`${actionNumber}. ${title}`);
      actionLines.push(
        ...group.blockers.map((blocker) => `   ${formatBlocker(blocker)}`),
      );
      actionLines.push('');
    }
    for (const activation of group.reports) {
      if (activation.status !== 'failed') continue;
      actionNumber += 1;
      actionLines.push(
        `${actionNumber}. ${group.targetName} failed during activation`,
      );
      actionLines.push(`   ${activationLine(activation)}`);
      actionLines.push(...failedEntryLines(activation));
      actionLines.push('');
    }
  }
  if (actionLines.length > 0) {
    while (actionLines.at(-1) === '') actionLines.pop();
    lines.push('', 'Action required', ...actionLines);
  }

  const retryTags = report.groups
    .filter(
      (group) =>
        isBlocked(group) ||
        group.reports.some((activation) => activation.status === 'failed'),
    )
    .map((group) => group.targetName);
  if (retryTags.length > 0) {
    lines.push('', 'Retry', `mev make ${retryTags.join(' ')}`);
  }

  if (options.footer && options.footer.length > 0) {
    lines.push('', ...options.footer);
  }

  return lines.join('\n');
}

import type { InstallReport } from '../../brew/install';
import { groupSucceeded } from '../../provisioning/group-outcome';
import {
  OUTCOME_STATUSES,
  type ResourceOutcome,
} from '../../provisioning/resource-outcome';
import type { ActivationGroupReport, MakeReport } from '../../provisioning/run';
import { makeStyle } from './style';

interface RenderOptions {
  readonly isTTY: boolean;
}

interface ReportOptions extends RenderOptions {
  readonly durationMs?: number;
  readonly footer?: readonly string[];
}

function displayStatus(status: ResourceOutcome['status']): string {
  return status === 'unchanged' ? 'current' : status;
}

function statusText(status: ResourceOutcome['status'], isTTY: boolean): string {
  const c = makeStyle(isTTY);
  const text = displayStatus(status).padEnd(9);
  if (status === 'failed') return c.red(text);
  if (status === 'blocked') return c.yellow(text);
  if (status === 'unchanged') return c.dim(text);
  return c.green(text);
}

function detail(outcome: ResourceOutcome): string | undefined {
  if (outcome.status === 'failed') return outcome.error;
  if (outcome.status === 'blocked') return outcome.reason;
  return outcome.details?.join('; ');
}

function outcomeLine(outcome: ResourceOutcome, options: RenderOptions): string {
  const suffix = detail(outcome);
  return `  ${statusText(outcome.status, options.isTTY)} ${outcome.label}${suffix ? ` — ${suffix}` : ''}`;
}

function activationLines(
  group: ActivationGroupReport,
  options: RenderOptions,
): string[] {
  const lines: string[] = [];
  for (const report of group.reports) {
    const unchanged = report.outcomes.filter(
      (outcome) => outcome.status === 'unchanged',
    );
    const visible = report.outcomes.filter(
      (outcome) => outcome.status !== 'unchanged',
    );
    lines.push(...visible.map((outcome) => outcomeLine(outcome, options)));

    if (report.description.unchangedCollection && unchanged.length > 0) {
      const other = visible.length > 0 ? ' other' : '';
      lines.push(
        outcomeLine(
          {
            label: `${unchanged.length}${other} ${report.description.unchangedCollection}`,
            status: 'unchanged',
          },
          options,
        ),
      );
    } else {
      lines.push(...unchanged.map((outcome) => outcomeLine(outcome, options)));
    }
    for (const notice of report.notices ?? []) {
      lines.push(`  notice   ${notice}`);
    }
  }
  return lines;
}

export function renderTargetReport(
  group: ActivationGroupReport,
  options: RenderOptions,
): string {
  const lines = [group.targetName];
  if (group.blockers.length > 0) {
    for (const blocker of group.blockers) {
      const label =
        blocker.kind === 'deploy'
          ? `managed configuration for ${blocker.role}`
          : `${blocker.token.kind} ${blocker.token.name}`;
      lines.push(
        outcomeLine({ label, status: 'failed', error: blocker.error }, options),
      );
    }
    lines.push(
      outcomeLine(
        {
          label: `${group.reports.length} dependent resources`,
          status: 'blocked',
          reason: 'prerequisite failed',
        },
        options,
      ),
    );
  } else {
    lines.push(...activationLines(group, options));
  }
  if (group.markerError) {
    lines.push(
      outcomeLine(
        {
          label: 'successful-state record',
          status: 'failed',
          error: group.markerError,
        },
        options,
      ),
    );
  }
  if (lines.length === 1) {
    lines.push(
      outcomeLine(
        { label: 'declared resources', status: 'unchanged' },
        options,
      ),
    );
  }
  return lines.join('\n');
}

export function renderTargetCompletionLine(
  group: ActivationGroupReport,
  options: RenderOptions,
): string {
  return renderTargetReport(group, options);
}

function packageOutcome(report: InstallReport): ResourceOutcome {
  const label = `${report.token.kind} ${report.token.name}`;
  switch (report.status) {
    case 'installed':
      return { label, status: 'changed', details: ['installed'] };
    case 'upgrade-applied':
      return {
        label,
        status: 'applied',
        details: ['upgrade completed; version change not probed'],
      };
    case 'present':
      return { label, status: 'unchanged', details: ['already installed'] };
    case 'failed':
      return {
        label,
        status: 'failed',
        error: report.error ?? 'Unknown error.',
      };
  }
}

export function renderPackageReport(
  reports: readonly InstallReport[],
  options: RenderOptions,
): string | null {
  if (reports.length === 0) return null;
  const outcomes = reports.map(packageOutcome);
  const unchanged = outcomes.filter(
    (outcome) => outcome.status === 'unchanged',
  );
  const visible = outcomes.filter((outcome) => outcome.status !== 'unchanged');
  const lines = [
    'Homebrew',
    ...visible.map((outcome) => outcomeLine(outcome, options)),
  ];
  if (unchanged.length > 0) {
    const other = visible.length > 0 ? ' other' : '';
    lines.push(
      outcomeLine(
        {
          label: `${unchanged.length}${other} packages`,
          status: 'unchanged',
        },
        options,
      ),
    );
  }
  return lines.join('\n');
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds === 0) return '<1s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

function countStatuses(report: MakeReport): Map<string, number> {
  const statuses = new Map<string, number>();
  const add = (status: string) =>
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  for (const item of report.install) add(packageOutcome(item).status);
  for (const group of report.groups) {
    for (const activation of group.reports) {
      for (const outcome of activation.outcomes) add(outcome.status);
    }
    if (group.markerError) add('failed');
  }
  return statuses;
}

function actionRequiredLines(report: MakeReport): string[] {
  const lines: string[] = [];
  for (const group of report.groups) {
    for (const blocker of group.blockers) {
      lines.push(
        `${group.targetName}: ${blocker.kind === 'deploy' ? blocker.role : blocker.token.name}: ${blocker.error}`,
      );
    }
    for (const activation of group.reports) {
      for (const outcome of activation.outcomes) {
        if (outcome.status === 'failed') {
          lines.push(`${group.targetName}: ${outcome.label}: ${outcome.error}`);
        } else if (
          outcome.status === 'blocked' &&
          group.blockers.length === 0
        ) {
          lines.push(
            `${group.targetName}: ${outcome.label}: ${outcome.reason}`,
          );
        }
      }
    }
    if (group.markerError) {
      lines.push(
        `${group.targetName}: successful-state record: ${group.markerError}`,
      );
    }
  }
  return lines;
}

export function renderMakeReport(
  report: MakeReport,
  options: ReportOptions,
): string {
  const c = makeStyle(options.isTTY);
  const result = report.failed ? c.red('failed') : c.green('success');
  const counts = countStatuses(report);
  const countLine = OUTCOME_STATUSES.flatMap((status) => {
    const count = counts.get(status);
    return count
      ? [`${count} ${displayStatus(status as ResourceOutcome['status'])}`]
      : [];
  }).join(', ');
  const lines = [`Result: ${result}${countLine ? ` — ${countLine}` : ''}`];
  const duration = formatDuration(options.durationMs);
  if (duration) lines.push(`Duration: ${duration}`);

  const actions = actionRequiredLines(report);
  if (actions.length > 0) lines.push('', 'Action required', ...actions);
  const retry = report.groups
    .filter((group) => !groupSucceeded(group))
    .map((group) => group.targetName);
  if (retry.length > 0) lines.push('', `Retry: mev make ${retry.join(' ')}`);
  if (options.footer && options.footer.length > 0) {
    lines.push('', ...options.footer);
  }
  return lines.join('\n');
}

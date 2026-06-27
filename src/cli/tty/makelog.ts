import type {
  ActivationReport,
  StepReport,
} from '../../provisioning/activation';
import type { DeployResult } from '../../provisioning/deploy';
import type { MakePlan } from '../../provisioning/plan';
import type {
  ActivationBlocker,
  ActivationGroupReport,
  MakeReport,
} from '../../provisioning/run';
import { makeStyle } from './style';

interface RenderOptions {
  readonly plan: boolean;
  readonly isTTY?: boolean;
}

interface ReportOptions extends RenderOptions {
  readonly durationMs?: number;
  readonly footer?: readonly string[];
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

function isBlocked(group: ActivationGroupReport): boolean {
  return group.blockers.length > 0;
}

function isAllUnchanged(group: ActivationGroupReport): boolean {
  return (
    !isBlocked(group) &&
    group.reports.length > 0 &&
    group.reports.every((r) => r.status === 'unchanged')
  );
}

function formatBlocker(blocker: ActivationBlocker): string {
  if (blocker.kind === 'deploy') {
    return `deploy role ${blocker.role}: ${blocker.error}`;
  }
  return `${blocker.token.kind} ${blocker.token.name}: ${blocker.error}`;
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

  const renderEntries = (entries: readonly StepReport[]): string[] => {
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

    if (isBlocked(group)) {
      blocks.push(
        [
          c.yellow(group.tag),
          ...group.blockers.map((blocker) =>
            c.yellow(`  blocked by ${formatBlocker(blocker)}`),
          ),
          c.dim(`  ${group.reports.length} blocked`),
        ].join('\n'),
      );
      continue;
    }

    const active = group.reports.filter((r) => r.status !== 'unchanged');
    const unchanged = group.reports.length - active.length;
    const header = c.bold(group.tag);
    const lines = [header, ...renderActive(active)];
    if (unchanged > 0) {
      lines.push(c.dim(`  ${unchanged} unchanged`));
    }
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
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

function activationLine(report: ActivationReport): string {
  return `${report.verb} ${report.source} -> ${report.dest}`;
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

function countStatus(
  reports: readonly ActivationReport[],
  status: ActivationReport['status'],
): number {
  return reports.filter((report) => report.status === status).length;
}

function appendCount(parts: string[], count: number, label: string): void {
  if (count > 0) parts.push(`${count} ${label}`);
}

export function renderMakeReport(
  report: MakeReport,
  options: ReportOptions,
): string {
  const isTTY = options.isTTY ?? process.stdout.isTTY ?? false;
  const c = makeStyle(isTTY);
  const result = options.plan ? 'plan' : report.failed ? 'failed' : 'success';
  const resultText =
    result === 'failed'
      ? c.red(result)
      : result === 'success'
        ? c.green(result)
        : c.yellow(result);

  const blockedTargets = report.groups.filter(isBlocked);
  const failedTargets = report.groups.filter(
    (group) =>
      !isBlocked(group) &&
      group.reports.some((activation) => activation.status === 'failed'),
  );
  const completedTargets =
    report.groups.length - blockedTargets.length - failedTargets.length;

  const lines = ['mev report', `Result: ${resultText}`];
  const duration = formatDuration(options.durationMs);
  if (duration) lines.push(`Duration: ${duration}`);
  lines.push(`Mode: ${options.plan ? 'preview' : 'apply'}`);
  if (options.plan) {
    lines.push(`Targets: ${report.groups.length} selected`);
  } else if (report.failed) {
    lines.push(
      `Targets: ${report.groups.length} selected, ${completedTargets} completed, ${failedTargets.length} failed, ${blockedTargets.length} blocked`,
    );
  } else {
    lines.push(`Targets: ${completedTargets} completed`);
  }

  const actionLines: string[] = [];
  let actionNumber = 0;
  for (const group of report.groups) {
    if (isBlocked(group)) {
      actionNumber += 1;
      const title =
        group.blockers.length === 1 && group.blockers[0]?.kind === 'package'
          ? `${group.tag} blocked by failed package`
          : group.blockers.length === 1 && group.blockers[0]?.kind === 'deploy'
            ? `${group.tag} blocked by deploy failure`
            : `${group.tag} blocked by prerequisite failures`;
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
        `${actionNumber}. ${group.tag} failed during activation`,
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

  const deployFailed = report.deploys.filter((deploy) => deploy.error).length;
  const deployed = report.deploys.filter(
    (deploy) => deploy.deployed && !deploy.error,
  ).length;
  const deployPresent = report.deploys.length - deployed - deployFailed;

  const brewInstalled = report.install.filter(
    (install) => install.status === 'installed',
  ).length;
  const brewPresent = report.install.filter(
    (install) => install.status === 'present',
  ).length;
  const brewMissing = report.install.filter(
    (install) => install.status === 'missing',
  ).length;
  const brewFailed = report.install.filter(
    (install) => install.status === 'failed',
  ).length;

  const activations = report.groups.flatMap((group) => group.reports);
  const changed = countStatus(activations, 'changed');
  const unchanged = countStatus(activations, 'unchanged');
  const failed = countStatus(activations, 'failed');
  const blocked = countStatus(activations, 'blocked');

  const activationParts: string[] = [];
  appendCount(
    activationParts,
    changed,
    options.plan ? 'would change' : 'changed',
  );
  appendCount(activationParts, unchanged, 'unchanged');
  appendCount(activationParts, failed, 'failed');
  appendCount(activationParts, blocked, 'blocked');

  lines.push('', 'Summary');
  lines.push(
    `Deploy: ${deployed} ${options.plan ? 'would deploy' : 'deployed'}, ${deployPresent} already present, ${deployFailed} failed`,
  );
  lines.push(
    options.plan
      ? `Brew: ${brewMissing} missing, ${brewPresent} present, ${brewFailed} failed`
      : `Brew: ${brewInstalled} installed, ${brewPresent} already present, ${brewFailed} failed`,
  );
  lines.push(
    `Activation: ${activationParts.length > 0 ? activationParts.join(', ') : 'none'}`,
  );

  const changedTargets = report.groups
    .filter((group) =>
      group.reports.some((activation) => activation.status === 'changed'),
    )
    .map((group) => group.tag);
  if (changedTargets.length > 0) {
    lines.push(
      '',
      options.plan ? 'Would change targets' : 'Changed targets',
      changedTargets.join(', '),
    );
  }

  if (options.plan) {
    const missing = report.install.filter(
      (install) => install.status === 'missing',
    );
    if (missing.length > 0) {
      lines.push(
        '',
        'Missing packages',
        ...missing.map(
          (install) => `${install.token.kind} ${install.token.name}`,
        ),
      );
    }
  }

  const retryTags = report.groups
    .filter(
      (group) =>
        isBlocked(group) ||
        group.reports.some((activation) => activation.status === 'failed'),
    )
    .map((group) => group.tag);
  if (retryTags.length > 0) {
    lines.push('', 'Retry', `mev make ${retryTags.join(' ')}`);
  }

  if (options.footer && options.footer.length > 0) {
    lines.push('', ...options.footer);
  }

  return lines.join('\n');
}

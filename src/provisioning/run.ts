import { type InstallReport, installPackages } from '../brew/install';
import { mergePackages, type PackageToken, tokens } from '../brew/package';
import { errorMessage } from '../errors';
import type { Context } from '../host/context';
import { resolveHostPath } from '../host/path';
import { materializeSymlink } from '../host/symlink';
import {
  type ActivationDescription,
  type ActivationReport,
  blockedReport,
  describeActivation,
  preservedPaths,
  runActivation,
} from './activation';
import { appliedPath, invalidateApplied, writeApplied } from './applied';
import { type DeployResult, deployRole } from './deploy';
import { groupSucceeded } from './group-outcome';
import { type MakePlan, planMake } from './plan';
import { outcomeStatus } from './resource-outcome';
import { targetSignature } from './signature';
import type { Target } from './target';

export type ActivationBlocker =
  | {
      readonly kind: 'deploy';
      readonly role: string;
      readonly error: string;
    }
  | {
      readonly kind: 'package';
      readonly token: PackageToken;
      readonly error: string;
    };

export interface ActivationGroupReport {
  readonly targetName: string;
  readonly blockers: readonly ActivationBlocker[];
  readonly reports: readonly ActivationReport[];
  /**
   * Set when the target activated successfully but recording its applied marker
   * failed. Isolated per group so one unwritable marker never aborts the run;
   * the target simply re-selects on the next sync (the safe direction).
   */
  readonly markerError?: string;
}

export interface MakeReport {
  readonly selection: MakePlan;
  readonly deploys: readonly DeployResult[];
  readonly install: readonly InstallReport[];
  readonly groups: readonly ActivationGroupReport[];
  readonly failed: boolean;
}

export type MakeEvent =
  | { readonly type: 'selection'; readonly selection: MakePlan }
  | { readonly type: 'deploy-complete'; readonly result: DeployResult }
  | { readonly type: 'package-phase-start'; readonly total: number }
  | {
      readonly type: 'package-start';
      readonly token: PackageToken;
      readonly action: 'install' | 'upgrade';
    }
  | { readonly type: 'package-tick'; readonly token: PackageToken }
  | {
      readonly type: 'package-phase-complete';
      readonly reports: readonly InstallReport[];
    }
  | { readonly type: 'activation-phase-start' }
  | {
      readonly type: 'activation-start';
      readonly targetName: string;
      readonly activation: ActivationDescription;
    }
  | {
      readonly type: 'target-complete';
      readonly group: ActivationGroupReport;
    };

export interface MakeRequest {
  readonly selectors: readonly string[];
  /** Upgrade selected Homebrew packages and installed latest-assumed items. */
  readonly upgrade?: boolean;
  readonly onEvent?: (event: MakeEvent) => void;
}

function sameToken(a: PackageToken, b: PackageToken): boolean {
  return a.kind === b.kind && a.name === b.name;
}

/**
 * Render a blocker as a single line. Part of the report model, not pure
 * presentation: `blockerReason` feeds this into each blocked activation's
 * report, and the TTY layer reuses it for the action-required section.
 */
export function formatBlocker(blocker: ActivationBlocker): string {
  if (blocker.kind === 'deploy') {
    return `deploy role ${blocker.role}: ${blocker.error}`;
  }
  return `${blocker.token.kind} ${blocker.token.name}: ${blocker.error}`;
}

function blockerReason(blockers: readonly ActivationBlocker[]): string {
  return blockers.map(formatBlocker).join('; ');
}

interface PreparationResult {
  readonly preserved: ReadonlySet<Target['activations'][number]>;
  readonly failedRoles: ReadonlyMap<string, string>;
}

async function prepareTargets(
  targets: readonly Target[],
  context: Context,
): Promise<PreparationResult> {
  const preserved = new Set<Target['activations'][number]>();
  const failedRoles = new Map<string, string>();
  for (const target of targets) {
    try {
      for (const activation of target.activations) {
        for (const path of preservedPaths(activation)) {
          if (await materializeSymlink(resolveHostPath(path, context.home))) {
            preserved.add(activation);
          }
        }
      }
      await target.preserveBeforeDeploy?.(context);
      await invalidateApplied(appliedPath(context.home, target.name));
    } catch (error) {
      failedRoles.set(
        target.role,
        `preparing ${target.name}: ${errorMessage(error)}`,
      );
    }
  }
  return { preserved, failedRoles };
}

interface DeployPhaseResult {
  readonly deploys: readonly DeployResult[];
  /** Role -> failure message; every group with that role cannot activate. */
  readonly failedRoles: ReadonlyMap<string, string>;
}

async function runDeployPhase(
  selection: MakePlan,
  context: Context,
  preparationFailures: ReadonlyMap<string, string>,
  onEvent?: MakeRequest['onEvent'],
): Promise<DeployPhaseResult> {
  const deploys: DeployResult[] = [];
  const failedRoles = new Map<string, string>();
  for (const role of selection.roles) {
    const preparationError = preparationFailures.get(role);
    const result = preparationError
      ? {
          role,
          changes: [],
          error: preparationError,
        }
      : await deployRole(role, context).catch((error) => ({
          role,
          changes: [],
          error: errorMessage(error),
        }));
    if (result.error) {
      failedRoles.set(role, result.error);
    }
    deploys.push(result);
    onEvent?.({ type: 'deploy-complete', result });
  }

  return { deploys, failedRoles };
}

function computeBlockers(
  group: Target,
  failedRoles: ReadonlyMap<string, string>,
  failedPackages: readonly InstallReport[],
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = [];
  const deployError = failedRoles.get(group.role);
  if (deployError) {
    blockers.push({ kind: 'deploy', role: group.role, error: deployError });
  }
  const requiredPackages = tokens(group.packages);
  for (const failedPackage of failedPackages) {
    if (
      requiredPackages.some((token) => sameToken(token, failedPackage.token))
    ) {
      blockers.push({
        kind: 'package',
        token: failedPackage.token,
        error: failedPackage.error ?? 'unknown error',
      });
    }
  }
  return blockers;
}

async function recordSuccessfulTarget(
  target: Target,
  group: ActivationGroupReport,
  context: Context,
): Promise<void> {
  if (!groupSucceeded(group)) return;
  const signature = await targetSignature(target, context.assets);
  await writeApplied(appliedPath(context.home, target.name), signature);
}

/**
 * Protect target-declared mutable state, then drive the three provisioning
 * phases: deploy each role's config, resolve required packages, and activate
 * the deployed assets grouped by target. Phase boundaries emit typed events so
 * the CLI can interleave transient progress with permanent result blocks; the
 * returned report carries everything needed to render the final summary.
 */
export async function runMake(
  request: MakeRequest,
  context: Context,
): Promise<MakeReport> {
  const selection = planMake(request.selectors);
  const upgrade = request.upgrade ?? false;
  request.onEvent?.({ type: 'selection', selection });
  const preparation = await prepareTargets(selection.groups, context);

  const { deploys, failedRoles } = await runDeployPhase(
    selection,
    context,
    preparation.failedRoles,
    request.onEvent,
  );

  const installablePackages = mergePackages(
    selection.groups
      .filter((group) => !failedRoles.has(group.role))
      .map((group) => group.packages),
  );
  const install = await installPackages(installablePackages, context, {
    upgrade,
    onStart: (total) =>
      request.onEvent?.({ type: 'package-phase-start', total }),
    onTokenStart: (token, action) =>
      request.onEvent?.({ type: 'package-start', token, action }),
    onTick: (token) => request.onEvent?.({ type: 'package-tick', token }),
  });
  const failedPackages = install.filter((r) => r.status === 'failed');
  request.onEvent?.({ type: 'package-phase-complete', reports: install });

  const groups: ActivationGroupReport[] = [];
  const changesByRole = new Map(
    deploys.map((deploy) => [deploy.role, deploy.changes] as const),
  );
  if (selection.groups.length > 0) {
    request.onEvent?.({ type: 'activation-phase-start' });
  }
  for (const group of selection.groups) {
    const blockers = computeBlockers(group, failedRoles, failedPackages);

    if (blockers.length > 0) {
      const reason = blockerReason(blockers);
      const groupReport = {
        targetName: group.name,
        blockers,
        reports: group.activations.map((activation) =>
          blockedReport(activation, reason),
        ),
      };
      groups.push(groupReport);
      request.onEvent?.({ type: 'target-complete', group: groupReport });
      continue;
    }
    const reports: ActivationReport[] = [];
    let activationBlocked = false;
    for (const activation of group.activations) {
      if (activationBlocked) {
        reports.push(blockedReport(activation));
        continue;
      }
      request.onEvent?.({
        type: 'activation-start',
        targetName: group.name,
        activation: describeActivation(activation),
      });
      const report = await runActivation(activation, context, {
        upgrade,
        sourceChanges: changesByRole.get(group.role) ?? [],
        preserved: preparation.preserved.has(activation),
      });
      reports.push(report);
      activationBlocked =
        outcomeStatus(report.outcomes) === 'failed' ||
        outcomeStatus(report.outcomes) === 'blocked';
    }
    const baseReport: ActivationGroupReport = {
      targetName: group.name,
      blockers,
      reports,
    };
    // Isolate the marker write: a failure here surfaces on this group's report
    // and the loop continues, so later targets still activate.
    let markerError: string | undefined;
    try {
      await recordSuccessfulTarget(group, baseReport, context);
    } catch (error) {
      markerError = errorMessage(error);
    }
    const groupReport: ActivationGroupReport =
      markerError === undefined ? baseReport : { ...baseReport, markerError };
    groups.push(groupReport);
    request.onEvent?.({ type: 'target-complete', group: groupReport });
  }

  const failed =
    failedRoles.size > 0 ||
    install.some((r) => r.status === 'failed') ||
    groups.some((group) => !groupSucceeded(group));

  return { selection, deploys, install, groups, failed };
}

import { type InstallReport, installPackages } from '../brew/install';
import { type PackageToken, tokens } from '../brew/package';
import { errorMessage } from '../errors';
import type { Context } from '../host/context';
import { resolveHostPath } from '../host/path';
import { materializeSymlink } from '../host/symlink';
import {
  type ActivationReport,
  blockedReport,
  type Described,
  describeActivation,
  preservedPaths,
  runActivation,
} from './activation';
import { appliedPath, invalidateApplied, writeApplied } from './applied';
import { type DeployResult, deployRole } from './deploy';
import { groupSucceeded } from './group-outcome';
import { type MakePlan, planMake } from './plan';
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

export interface ActivationStartEvent {
  readonly targetName: string;
  readonly activation: Described;
}

export interface MakeRequest {
  readonly selectors: readonly string[];
  /** Upgrade mode (`--upgrade`): refresh installed latest-assumed items. */
  readonly upgrade?: boolean;
  readonly onDeploy?: (result: DeployResult) => void;
  readonly onHeader?: (selection: MakePlan) => void;
  readonly onInstallStart?: (total: number) => void;
  readonly onInstallTokenStart?: (token: PackageToken) => void;
  readonly onInstallTick?: (token: PackageToken) => void;
  readonly onActivationPhaseStart?: () => void;
  readonly onActivationStart?: (event: ActivationStartEvent) => void;
  readonly onActivationTargetComplete?: (group: ActivationGroupReport) => void;
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

async function invalidateSelectedTargets(
  targets: readonly string[],
  context: Context,
): Promise<void> {
  // Promise.all, so a single invalidation failure rejects the batch. Accepted:
  // partial invalidation would only over-select on the next run, which is the
  // safe direction (a stale applied marker never suppresses a needed re-apply).
  await Promise.all(
    targets.map((target) =>
      invalidateApplied(appliedPath(context.home, target)),
    ),
  );
}

interface DeployPhaseResult {
  readonly deploys: readonly DeployResult[];
  /** Role -> failure message; every group with that role cannot activate. */
  readonly failedRoles: ReadonlyMap<string, string>;
}

async function runDeployPhase(
  selection: MakePlan,
  context: Context,
  onDeploy?: (result: DeployResult) => void,
): Promise<DeployPhaseResult> {
  const deploys: DeployResult[] = [];
  const failedRoles = new Map<string, string>();
  for (const role of selection.roles) {
    const result = await deployRole(role, context).catch((error) => ({
      role,
      deployed: false,
      files: [] as readonly string[],
      error: errorMessage(error),
    }));
    if (result.error) {
      failedRoles.set(role, result.error);
    }
    deploys.push(result);
    onDeploy?.(result);
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
 * the deployed assets grouped by target. Phase boundaries fire hooks so the CLI
 * can interleave a live install bar; the returned report carries everything
 * needed to render the log.
 */
export async function runMake(
  request: MakeRequest,
  context: Context,
): Promise<MakeReport> {
  const selection = planMake(request.selectors);

  // Preserve mutable host state before invalidating applied markers or
  // replacing deployed roles. A preservation failure leaves provisioning's
  // managed state untouched. The activation-derived paths come first so a kind
  // that inverts file ownership needs no per-target declaration; the hook is for
  // what only the target knows.
  for (const target of selection.groups) {
    for (const activation of target.activations) {
      for (const path of preservedPaths(activation)) {
        await materializeSymlink(resolveHostPath(path, context.home));
      }
    }
    await target.preserveBeforeDeploy?.(context);
  }

  await invalidateSelectedTargets(selection.targetNames, context);

  const { deploys, failedRoles } = await runDeployPhase(
    selection,
    context,
    request.onDeploy,
  );

  request.onHeader?.(selection);

  const install = await installPackages(selection.packages, context, {
    onStart: request.onInstallStart,
    onTokenStart: request.onInstallTokenStart,
    onTick: request.onInstallTick,
  });
  const failedPackages = install.filter((r) => r.status === 'failed');

  const groups: ActivationGroupReport[] = [];
  if (selection.groups.length > 0) {
    request.onActivationPhaseStart?.();
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
      request.onActivationTargetComplete?.(groupReport);
      continue;
    }
    const reports: ActivationReport[] = [];
    let activationBlocked = false;
    for (const activation of group.activations) {
      if (activationBlocked) {
        reports.push(blockedReport(activation));
        continue;
      }
      request.onActivationStart?.({
        targetName: group.name,
        activation: describeActivation(activation),
      });
      const report = await runActivation(activation, context, {
        upgrade: request.upgrade ?? false,
      });
      reports.push(report);
      activationBlocked =
        report.status === 'failed' || report.status === 'blocked';
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
    request.onActivationTargetComplete?.(groupReport);
  }

  const failed =
    failedRoles.size > 0 ||
    install.some((r) => r.status === 'failed') ||
    groups.some((group) => !groupSucceeded(group));

  return { selection, deploys, install, groups, failed };
}

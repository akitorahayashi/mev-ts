import { type InstallReport, installPackages } from '../brew/install';
import { type PackageToken, tokens } from '../brew/package';
import { errorMessage, ProvisioningError } from '../errors';
import type { Context } from '../host/context';
import {
  type ActivationReport,
  blockedReport,
  type Described,
  describeActivation,
  migrateLegacySymlinks,
  runActivation,
} from './activation';
import { appliedPath, invalidateApplied, writeApplied } from './applied';
import { type DeployResult, deployRole } from './deploy';
import { type MakePlan, planMake } from './plan';
import { allTargets } from './registry';
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
}

export interface MakeReport {
  readonly selection: MakePlan;
  readonly deploys: readonly DeployResult[];
  readonly install: readonly InstallReport[];
  readonly groups: readonly ActivationGroupReport[];
  readonly failed: boolean;
}

export interface ActivationPhaseEvent {
  readonly totalTargets: number;
}

export interface ActivationStartEvent {
  readonly targetName: string;
  readonly activation: Described;
}

export interface MakeRequest {
  readonly selectors: readonly string[];
  readonly onDeploy?: (result: DeployResult) => void;
  readonly onHeader?: (selection: MakePlan) => void;
  readonly onInstallStart?: (total: number) => void;
  readonly onInstallTokenStart?: (token: PackageToken) => void;
  readonly onInstallTick?: (token: PackageToken) => void;
  readonly onActivationPhaseStart?: (event: ActivationPhaseEvent) => void;
  readonly onActivationStart?: (event: ActivationStartEvent) => void;
  readonly onActivationTargetComplete?: (group: ActivationGroupReport) => void;
}

function sameToken(a: PackageToken, b: PackageToken): boolean {
  return a.kind === b.kind && a.name === b.name;
}

export function formatBlocker(blocker: ActivationBlocker): string {
  if (blocker.kind === 'deploy') {
    return `deploy role ${blocker.role}: ${blocker.error}`;
  }
  return `${blocker.token.kind} ${blocker.token.name}: ${blocker.error}`;
}

function blockerReason(blockers: readonly ActivationBlocker[]): string {
  return blockers.map(formatBlocker).join('; ');
}

function targetNamed(name: string): Target {
  const match = allTargets().find((target) => target.name === name);
  if (!match) {
    throw new ProvisioningError(
      `Provisioning plan referenced unknown target '${name}'.`,
    );
  }
  return match;
}

function groupSucceeded(group: ActivationGroupReport): boolean {
  return (
    group.blockers.length === 0 &&
    group.reports.every(
      (report) => report.status !== 'failed' && report.status !== 'blocked',
    )
  );
}

async function invalidateSelectedTargets(
  targets: readonly string[],
  context: Context,
): Promise<void> {
  await Promise.all(
    targets.map((target) =>
      invalidateApplied(appliedPath(context.home, target)),
    ),
  );
}

async function recordSuccessfulTarget(
  group: ActivationGroupReport,
  context: Context,
): Promise<void> {
  if (!groupSucceeded(group)) return;
  const target = targetNamed(group.targetName);
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
  // managed state untouched.
  for (const targetName of selection.targetNames) {
    await targetNamed(targetName).preserveBeforeDeploy?.(context);
  }

  await invalidateSelectedTargets(selection.targetNames, context);

  // Phase 1: deploy configs for each role.
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
    request.onDeploy?.(result);
  }

  for (const group of selection.groups) {
    if (failedRoles.has(group.role)) {
      continue;
    }
    await migrateLegacySymlinks(group.activations, context).catch((error) => {
      failedRoles.set(
        group.role,
        `legacy link migration: ${errorMessage(error)}`,
      );
    });
  }

  request.onHeader?.(selection);

  // Phase 2: resolve required packages as a batch with a progress bar.
  const install = await installPackages(selection.packages, context, {
    onStart: request.onInstallStart,
    onTokenStart: request.onInstallTokenStart,
    onTick: request.onInstallTick,
  });
  const failedPackages = install.filter((r) => r.status === 'failed');

  // Phase 3: activate deployed assets, grouped and attributed by tag.
  const groups: ActivationGroupReport[] = [];
  if (selection.groups.length > 0) {
    request.onActivationPhaseStart?.({
      totalTargets: selection.groups.length,
    });
  }
  for (const group of selection.groups) {
    const blockers: ActivationBlocker[] = [];
    const deployError = failedRoles.get(group.role);
    if (deployError) {
      blockers.push({
        kind: 'deploy',
        role: group.role,
        error: deployError,
      });
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

    if (blockers.length > 0) {
      const reason = blockerReason(blockers);
      const groupReport = {
        targetName: group.targetName,
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
    for (const activation of group.activations) {
      request.onActivationStart?.({
        targetName: group.targetName,
        activation: describeActivation(activation),
      });
      reports.push(await runActivation(activation, context));
    }
    const groupReport = { targetName: group.targetName, blockers, reports };
    groups.push(groupReport);
    await recordSuccessfulTarget(groupReport, context);
    request.onActivationTargetComplete?.(groupReport);
  }

  const failed =
    failedRoles.size > 0 ||
    install.some((r) => r.status === 'failed') ||
    groups.some(
      (g) =>
        g.blockers.length > 0 || g.reports.some((r) => r.status === 'failed'),
    );

  return { selection, deploys, install, groups, failed };
}

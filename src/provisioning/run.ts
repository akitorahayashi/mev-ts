import pLimit from 'p-limit';
import { type InstallReport, installPackages } from '../brew/install';
import { type Context, createContext } from '../host/context';
import {
  type ActivationReport,
  blockedReport,
  runActivation,
} from './activation';
import { type DeployResult, deployRole, inspectRole } from './deploy';
import type { PackageToken } from './package';
import { type MakePlan, planMake } from './plan';

const ACTIVATION_CONCURRENCY = 8;

export interface ActivationGroupReport {
  readonly tag: string;
  readonly blocked: boolean;
  readonly reports: readonly ActivationReport[];
}

export interface MakeReport {
  readonly selection: MakePlan;
  readonly deploys: readonly DeployResult[];
  readonly install: readonly InstallReport[];
  readonly groups: readonly ActivationGroupReport[];
  readonly failed: boolean;
}

export interface MakeRequest {
  readonly tags: readonly string[];
  readonly plan: boolean;
  readonly overwrite: boolean;
  readonly onDeploy?: (result: DeployResult) => void;
  readonly onHeader?: (selection: MakePlan) => void;
  readonly onInstallStart?: (total: number) => void;
  readonly onInstallTick?: (token: PackageToken) => void;
}

/**
 * Drive the three provisioning phases in Rust's order: deploy each role's
 * config, resolve required packages, then activate (link) the deployed assets
 * grouped by tag. Phase boundaries fire hooks so the CLI can interleave a live
 * install bar; the returned report carries everything needed to render the log.
 */
export async function runMake(
  request: MakeRequest,
  context: Context = createContext({ overwrite: request.overwrite }),
): Promise<MakeReport> {
  const selection = planMake(request.tags);

  // Phase 1: deploy configs for each role.
  const deploys: DeployResult[] = [];
  const failedRoles = new Set<string>();
  for (const role of selection.roles) {
    const result = request.plan
      ? await inspectRole(role, context)
      : await deployRole(role, context).catch((error) => ({
          role,
          deployed: false,
          files: [] as readonly string[],
          error: error instanceof Error ? error.message : String(error),
        }));
    if (result.error) {
      failedRoles.add(role);
    }
    deploys.push(result);
    request.onDeploy?.(result);
  }

  request.onHeader?.(selection);

  // Phase 2: resolve required packages as a batch with a progress bar.
  const install = await installPackages(
    selection.packages,
    context,
    request.plan,
    {
      onStart: request.onInstallStart,
      onTick: request.onInstallTick,
    },
  );

  // Phase 3: activate deployed assets, grouped and attributed by tag.
  const limit = pLimit(ACTIVATION_CONCURRENCY);
  const groups: ActivationGroupReport[] = [];
  for (const group of selection.groups) {
    if (failedRoles.has(group.role)) {
      groups.push({
        tag: group.tag,
        blocked: true,
        reports: group.activations.map(blockedReport),
      });
      continue;
    }
    const reports = await Promise.all(
      group.activations.map((activation) =>
        limit(() => runActivation(activation, context, request.plan)),
      ),
    );
    groups.push({ tag: group.tag, blocked: false, reports });
  }

  const failed =
    failedRoles.size > 0 ||
    install.some((r) => r.status === 'failed') ||
    groups.some(
      (g) => g.blocked || g.reports.some((r) => r.status === 'failed'),
    );

  return { selection, deploys, install, groups, failed };
}

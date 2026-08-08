import { errorMessage, ProvisioningError } from '../errors';
import type { CommandOptions } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { normalizedPackageName } from './manifest';

export interface UpgradeReport {
  readonly status: 'upgraded' | 'unchanged';
  readonly previousVersion: string;
  readonly version: string;
  /** Injected dependencies pipx upgraded alongside the main package. */
  readonly injectedUpgraded: readonly string[];
}

/**
 * Upgrade one pipx-managed tool via the machine-readable envelope
 * (`--output json`) so the changed/unchanged classification comes from pipx's
 * own per-package status instead of parsing human-oriented output.
 */
export async function upgrade(
  context: Context,
  options: CommandOptions,
  pkg: string,
  includeInjected: boolean,
): Promise<UpgradeReport> {
  const args = ['upgrade', '--output', 'json'];
  if (includeInjected) args.push('--include-injected');
  args.push(pkg);
  const result = await runProcessStep(
    context.commands,
    'pipx',
    args,
    `pipx upgrade failed for ${pkg}`,
    options,
  );
  return parseUpgradeEnvelope(result.stdout, pkg);
}

interface UpgradedPackage {
  readonly package: string;
  readonly status: string;
  readonly previousVersion: string;
  readonly version: string;
  readonly injected: boolean;
}

function parsePackageEntry(entry: unknown, pkg: string): UpgradedPackage {
  if (
    !isRecord(entry) ||
    typeof entry['package'] !== 'string' ||
    typeof entry['status'] !== 'string' ||
    typeof entry['previous_version'] !== 'string' ||
    typeof entry['version'] !== 'string' ||
    typeof entry['injected'] !== 'boolean'
  ) {
    throw new ProvisioningError(
      `Invalid pipx upgrade output for ${pkg}: each package entry must contain string package, status, previous_version, and version, and a boolean injected flag.`,
    );
  }
  return {
    package: entry['package'],
    status: entry['status'],
    previousVersion: entry['previous_version'],
    version: entry['version'],
    injected: entry['injected'],
  };
}

export function parseUpgradeEnvelope(raw: string, pkg: string): UpgradeReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse pipx upgrade output for ${pkg} as JSON: ${errorMessage(error)}`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed['data'])) {
    throw new ProvisioningError(
      `Invalid pipx upgrade output for ${pkg}: expected an envelope with a data object.`,
    );
  }
  const packages = parsed['data']['packages'];
  if (!Array.isArray(packages)) {
    throw new ProvisioningError(
      `Invalid pipx upgrade output for ${pkg}: data.packages must be an array.`,
    );
  }

  let main: UpgradedPackage | undefined;
  const injectedUpgraded: string[] = [];
  for (const raw of packages) {
    const entry = parsePackageEntry(raw, pkg);
    if (entry.injected) {
      if (entry.status === 'upgraded') injectedUpgraded.push(entry.package);
      continue;
    }
    if (normalizedPackageName(entry.package) === normalizedPackageName(pkg)) {
      main = entry;
    }
  }
  if (!main) {
    throw new ProvisioningError(
      `pipx upgrade for ${pkg} reported no result for the package.`,
    );
  }
  // 'locked' and 'pinned' can only arise from out-of-band `pipx pin` or lock
  // state mev never creates, so they surface as failures instead of guesses.
  if (main.status !== 'upgraded' && main.status !== 'unchanged') {
    throw new ProvisioningError(
      `pipx upgrade for ${pkg} reported unsupported status '${main.status}'.`,
    );
  }
  return {
    status: main.status,
    previousVersion: main.previousVersion,
    version: main.version,
    injectedUpgraded,
  };
}

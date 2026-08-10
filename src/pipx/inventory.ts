import { ProvisioningError } from '../errors';
import type { CommandOptions } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord, parseJsonLabeled } from '../host/parse';
import { normalizedPackageName } from './manifest';

export interface Installed {
  /**
   * The spelling pipx reports, preserved because pipx addresses venvs by that
   * literal name: uninstall must pass this form, not the manifest's.
   */
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

interface PipxListJson {
  readonly venvs?: Record<
    string,
    {
      readonly metadata?: {
        readonly main_package?: {
          readonly package: string;
          readonly package_version: string;
          readonly app_paths_of_dependencies?: Record<string, unknown>;
        };
      };
    }
  >;
}

/**
 * Keyed by `normalizedPackageName`, since PyPI treats hyphen, underscore, and
 * case variants as one name — lookups must normalize the queried name the same
 * way so a manifest spelling always finds the installed tool.
 */
export async function listInstalled(
  context: Context,
  options: CommandOptions,
): Promise<Map<string, Installed>> {
  const result = await runProcessStep(
    context.commands,
    'pipx',
    ['list', '--json'],
    'pipx list --json failed',
    options,
  );
  const data = parseJsonLabeled(
    result.stdout,
    'pipx list --json output',
  ) as PipxListJson;
  if (!isRecord(data)) {
    throw new ProvisioningError(
      'Invalid pipx list --json output: expected an object.',
    );
  }
  if (data['venvs'] !== undefined && !isRecord(data['venvs'])) {
    throw new ProvisioningError(
      'Invalid pipx list --json output: venvs must be an object.',
    );
  }
  const map = new Map<string, Installed>();
  for (const [name, venv] of Object.entries(data['venvs'] ?? {})) {
    if (!isRecord(venv)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: venv '${name}' must be an object.`,
      );
    }
    const metadata = venv['metadata'];
    if (metadata !== undefined && !isRecord(metadata)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: metadata for '${name}' must be an object.`,
      );
    }
    const main = metadata?.['main_package'];
    if (!main) continue;
    if (!isRecord(main)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: main_package for '${name}' must be an object.`,
      );
    }
    if (
      typeof main['package'] !== 'string' ||
      typeof main['package_version'] !== 'string'
    ) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: main_package for '${name}' must contain string package and package_version.`,
      );
    }
    const deps = main['app_paths_of_dependencies'];
    if (deps !== undefined && !isRecord(deps)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: app_paths_of_dependencies for '${name}' must be an object.`,
      );
    }
    map.set(normalizedPackageName(main['package']), {
      name: main['package'],
      version: main['package_version'],
      dependencies: Object.keys(deps ?? {}),
    });
  }
  return map;
}

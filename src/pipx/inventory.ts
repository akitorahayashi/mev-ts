import { errorMessage, ProvisioningError } from '../errors';
import type { CommandOptions } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';

export interface Installed {
  readonly packageOrUrl: string;
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
          readonly package_or_url: string;
          readonly package_version: string;
          readonly app_paths_of_dependencies?: Record<string, unknown>;
        };
      };
    }
  >;
}

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
  let data: PipxListJson;
  try {
    data = JSON.parse(result.stdout) as PipxListJson;
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse pipx list --json output as JSON: ${errorMessage(error)}`,
    );
  }
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
      typeof main['package_or_url'] !== 'string' ||
      typeof main['package_version'] !== 'string'
    ) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: main_package for '${name}' must contain string package, package_or_url, and package_version.`,
      );
    }
    const deps = main['app_paths_of_dependencies'];
    if (deps !== undefined && !isRecord(deps)) {
      throw new ProvisioningError(
        `Invalid pipx list --json output: app_paths_of_dependencies for '${name}' must be an object.`,
      );
    }
    map.set(main['package'], {
      packageOrUrl: main['package_or_url'],
      version: main['package_version'],
      dependencies: Object.keys(deps ?? {}),
    });
  }
  return map;
}

import { errorMessage, ProvisioningError } from '../errors';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { runPnpm } from './command';
import type { PnpmRuntime } from './environment';

export interface InstalledPackage {
  readonly version: string;
}

/**
 * The installed global packages, read from `pnpm ls -g --depth=0 --json`: an
 * array of projects (one for the global store) whose `dependencies` key is
 * absent when nothing is installed.
 */
export async function listGlobal(
  context: Context,
  runtime: PnpmRuntime,
): Promise<Map<string, InstalledPackage>> {
  const stdout = await runPnpm(
    context,
    runtime,
    ['ls', '-g', '--depth=0', '--json'],
    'pnpm ls -g failed',
  );
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse pnpm ls -g --json output as JSON: ${errorMessage(error)}`,
    );
  }
  if (!Array.isArray(data)) {
    throw new ProvisioningError(
      'Invalid pnpm ls -g --json output: expected an array of projects.',
    );
  }
  const map = new Map<string, InstalledPackage>();
  for (const project of data) {
    if (!isRecord(project)) {
      throw new ProvisioningError(
        'Invalid pnpm ls -g --json output: each project must be an object.',
      );
    }
    const dependencies = project['dependencies'];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) {
      throw new ProvisioningError(
        'Invalid pnpm ls -g --json output: dependencies must be an object.',
      );
    }
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!isRecord(dependency) || typeof dependency['version'] !== 'string') {
        throw new ProvisioningError(
          `Invalid pnpm ls -g --json output: dependency '${name}' must contain a string version.`,
        );
      }
      map.set(name, { version: dependency['version'] });
    }
  }
  return map;
}

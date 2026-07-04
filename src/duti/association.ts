import { ProvisioningError } from '../errors';
import { commandFailureDetail } from '../host/command';
import type { Context } from '../host/context';
import { loadYaml } from '../host/yaml';

interface DutiApp {
  readonly bundle_id: string;
  readonly extensions: readonly string[];
}

interface DutiConfig {
  readonly default_apps: readonly DutiApp[];
}

export interface Association {
  readonly bundleId: string;
  readonly extension: string;
}

export async function parseAssociations(
  raw: string,
  path: string,
): Promise<Association[]> {
  const parsed = loadYaml(raw) as DutiConfig;
  if (!parsed?.default_apps || !Array.isArray(parsed.default_apps)) {
    throw new ProvisioningError(
      `Duti config must contain a default_apps sequence: ${path}`,
    );
  }
  return parsed.default_apps.flatMap((app: DutiApp) => {
    if (typeof app?.bundle_id !== 'string' || app.bundle_id.length === 0) {
      throw new ProvisioningError(
        `Invalid entry in duti config: each app must have a string bundle_id.`,
      );
    }
    if (!Array.isArray(app.extensions)) {
      throw new ProvisioningError(
        `Invalid entry in duti config: each app must have an extensions array.`,
      );
    }
    if (!app.extensions.every((extension) => typeof extension === 'string')) {
      throw new ProvisioningError(
        `Invalid entry in duti config: each app must have an extensions array of strings.`,
      );
    }
    return app.extensions.map((extension) => ({
      bundleId: app.bundle_id,
      extension,
    }));
  });
}

/**
 * The bundle id currently handling `extension`, or null when duti reports no
 * handler. A non-zero `duti -x` (no handler registered yet) is the not-set
 * signal, not a failure.
 */
export async function currentApp(
  extension: string,
  context: Context,
): Promise<string | null> {
  const result = await context.commands.run('duti', ['-x', extension]);
  if (result.code !== 0) return null;
  const lines = result.stdout.trimEnd().split('\n');
  const lastLine = lines.at(-1)?.trim();
  return lastLine || null;
}

/** Register `bundleId` as the handler for `.${extension}`. Throws on failure. */
export async function setApp(
  bundleId: string,
  extension: string,
  context: Context,
): Promise<void> {
  const result = await context.commands.run('duti', [
    '-s',
    bundleId,
    `.${extension}`,
    'all',
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      commandFailureDetail(result, `exit code ${result.code}`),
    );
  }
}

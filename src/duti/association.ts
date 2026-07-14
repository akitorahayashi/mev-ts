import { ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import { isRecord } from '../host/parse';
import { loadYaml } from '../host/yaml';

export interface Association {
  readonly bundleId: string;
  readonly extension: string;
}

export function parseAssociations(raw: string, path: string): Association[] {
  const parsed = loadYaml(raw);
  const defaultApps = isRecord(parsed) ? parsed.default_apps : undefined;
  if (!Array.isArray(defaultApps)) {
    throw new ProvisioningError(
      `Duti config must contain a default_apps sequence: ${path}`,
    );
  }
  return defaultApps.flatMap((app) => {
    if (!isRecord(app)) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must be a mapping.',
      );
    }
    const bundleId = app.bundle_id;
    if (typeof bundleId !== 'string' || bundleId.length === 0) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must have a string bundle_id.',
      );
    }
    const extensions = app.extensions;
    if (!Array.isArray(extensions)) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must have an extensions array.',
      );
    }
    if (!extensions.every((e): e is string => typeof e === 'string')) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must have an extensions array of strings.',
      );
    }
    return extensions.map((extension) => ({ bundleId, extension }));
  });
}

/**
 * The bundle id currently handling `extension`, or null when duti reports no
 * handler.
 *
 * A missing `duti` binary resolves as code 127 under the runner's spawn-failure
 * contract; that is a broken environment, surfaced as a failure rather than
 * masked as "no handler". A present `duti` exits non-zero when no handler is
 * registered for the extension yet — the genuine not-set signal, returned as
 * null so the caller registers one.
 */
export async function currentApp(
  extension: string,
  context: Context,
): Promise<string | null> {
  const result = await context.commands.run('duti', ['-x', extension]);
  if (result.code === 127) {
    throw new ProvisioningError(
      formatCommandFailure(`duti -x failed for .${extension}`, result),
    );
  }
  if (result.code !== 0) return null;
  // `duti -x` prints the handler's name, path, then reverse-DNS bundle id. Pick
  // the bundle-id-shaped line so a stray banner line is never read as the id.
  const bundleId = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(line))
    .at(-1);
  return bundleId ?? null;
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
      formatCommandFailure(`duti -s failed for .${extension}`, result),
    );
  }
}

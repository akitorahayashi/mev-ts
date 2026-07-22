import { ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import { isRecord, requireExactKeys, requireUniqueBy } from '../host/parse';
import { loadYaml } from '../host/yaml';

export interface Association {
  readonly bundleId: string;
  readonly extension: string;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code < 0x20 || code === 0x7f);
  });
}

export function parseAssociations(raw: string, path: string): Association[] {
  const parsed = loadYaml(raw, path);
  if (!isRecord(parsed)) {
    throw new ProvisioningError(
      `Duti config must contain a default_apps sequence: ${path}`,
    );
  }
  requireExactKeys(parsed, ['default_apps'], `Duti config ${path}`);
  const defaultApps = parsed['default_apps'];
  if (!Array.isArray(defaultApps)) {
    throw new ProvisioningError(
      `Duti config must contain a default_apps sequence: ${path}`,
    );
  }
  const associations = defaultApps.flatMap((app) => {
    if (!isRecord(app)) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must be a mapping.',
      );
    }
    requireExactKeys(
      app,
      ['bundle_id', 'extensions'],
      'Invalid entry in duti config',
    );
    const bundleId = app['bundle_id'];
    if (typeof bundleId !== 'string' || bundleId.length === 0) {
      throw new ProvisioningError(
        'Invalid entry in duti config: each app must have a string bundle_id.',
      );
    }
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(bundleId)) {
      throw new ProvisioningError(
        `Invalid entry in duti config for '${bundleId}': bundle_id must be a reverse-DNS identifier.`,
      );
    }
    const extensions = app['extensions'];
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
    for (const extension of extensions) {
      if (
        extension.length === 0 ||
        extension.startsWith('.') ||
        /\s|[/\\]/.test(extension) ||
        hasControlCharacter(extension)
      ) {
        throw new ProvisioningError(
          `Invalid entry in duti config for '${bundleId}': extension '${extension}' is invalid.`,
        );
      }
    }
    return extensions.map((extension) => ({ bundleId, extension }));
  });
  requireUniqueBy(
    associations,
    (association) => association.extension.toLowerCase(),
    `Duti config ${path}`,
  );
  return associations;
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
    .filter((line) => /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(line))
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

import { errorMessage, ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';
import {
  requireExactKeys,
  requireRecord,
  requireStringArray,
  requireUniqueBy,
} from '../host/parse';

export function parseExtensions(raw: string, path: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse extensions manifest as JSON: ${path}. ${errorMessage(error)}`,
    );
  }
  const record = requireRecord(parsed, `Extensions manifest ${path}`);
  requireExactKeys(record, ['extensions'], `Extensions manifest ${path}`);
  const extensions = requireStringArray(
    record['extensions'],
    `Extensions manifest ${path}: 'extensions'`,
  );
  if (!extensions.every((extension) => extension.trim().length > 0)) {
    throw new ProvisioningError(
      `Extensions manifest must contain an extensions array of non-empty strings: ${path}`,
    );
  }
  requireUniqueBy(
    extensions,
    (extension) => extension.toLowerCase(),
    `Extensions manifest ${path}`,
  );
  return [...extensions];
}

/**
 * The identifiers the editor CLI reports installed, lowercased so a desired id
 * matches regardless of the publisher's casing. Throws when the CLI is missing
 * or errors, which is a whole-activation failure.
 */
export async function listInstalled(
  command: string,
  context: Context,
): Promise<Set<string>> {
  const result = await context.commands.run(command, ['--list-extensions']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `${formatCommandFailure(`${command} --list-extensions failed`, result)}. Is ${command} installed and on PATH?`,
    );
  }
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Install `extension` through the editor CLI. Throws on failure. */
export async function installExtension(
  command: string,
  extension: string,
  context: Context,
): Promise<void> {
  const result = await context.commands.run(command, [
    '--install-extension',
    extension,
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(
        `${command} --install-extension failed for ${extension}`,
        result,
      ),
    );
  }
}

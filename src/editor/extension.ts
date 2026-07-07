import { errorMessage, ProvisioningError } from '../errors';
import { commandFailureDetail } from '../host/command';
import type { Context } from '../host/context';

interface ExtensionsConfig {
  readonly extensions: readonly string[];
}

export function parseExtensions(raw: string, path: string): string[] {
  let parsed: ExtensionsConfig;
  try {
    parsed = JSON.parse(raw) as ExtensionsConfig;
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse extensions manifest as JSON: ${path}. ${errorMessage(error)}`,
    );
  }
  if (!parsed?.extensions || !Array.isArray(parsed.extensions)) {
    throw new ProvisioningError(
      `Extensions manifest must contain an extensions array: ${path}`,
    );
  }
  if (
    !parsed.extensions.every(
      (extension) =>
        typeof extension === 'string' && extension.trim().length > 0,
    )
  ) {
    throw new ProvisioningError(
      `Extensions manifest must contain an extensions array of non-empty strings: ${path}`,
    );
  }
  return [...parsed.extensions];
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
    const detail = commandFailureDetail(result, `exit code ${result.code}`);
    throw new ProvisioningError(
      `${command} --list-extensions failed: ${detail}. Is ${command} installed and on PATH?`,
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
      commandFailureDetail(result, `exit code ${result.code}`),
    );
  }
}

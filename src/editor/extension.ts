import { ProvisioningError } from '../errors';
import type { Context } from '../host/context';

interface ExtensionsConfig {
  readonly extensions: readonly string[];
}

export function parseExtensions(raw: string, path: string): string[] {
  let parsed: ExtensionsConfig;
  try {
    parsed = JSON.parse(raw) as ExtensionsConfig;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProvisioningError(
      `Failed to parse extensions manifest as JSON: ${path}. ${detail}`,
    );
  }
  if (!parsed?.extensions || !Array.isArray(parsed.extensions)) {
    throw new ProvisioningError(
      `Extensions manifest must contain an extensions array: ${path}`,
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
    throw new ProvisioningError(
      `${command} --list-extensions failed: ${result.stderr.trim() || `exit code ${result.code}`}. Is ${command} installed and on PATH?`,
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
      result.stderr.trim() || `exit code ${result.code}`,
    );
  }
}

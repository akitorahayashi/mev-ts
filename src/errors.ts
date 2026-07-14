import { UsageError } from 'clipanion';

/**
 * Error taxonomy for the CLI:
 *
 * - `CommandLineError` (clipanion's `UsageError`) is command-line misuse — an
 *   unknown argument or bad selector. Clipanion prints it to stdout with usage;
 *   it deliberately bypasses `runReportingDomainErrors`.
 * - `AppError` is the base for every domain failure surfaced by
 *   `runReportingDomainErrors`, which prints `<name>: <message>` to stderr and
 *   returns exit code 1. The identity feature throws `AppError` directly for its
 *   own domain failures (parsing/validating the identity store and its input).
 * - `ProvisioningError extends AppError` marks a failure in the provisioning or
 *   activation domain (deploy, package install, host commands, manifest parse).
 *
 * Handlers catch the `AppError` base, so the `AppError`/`ProvisioningError`
 * split is documentary: it names the failing domain at the throw site rather
 * than changing how the failure is reported.
 */
export { UsageError as CommandLineError };

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProvisioningError extends AppError {}

function formatError(error: unknown, seen: Set<Error>): string {
  if (!(error instanceof Error)) return String(error);

  const message = error.message;
  if (seen.has(error)) return message;
  seen.add(error);

  const details: string[] = [];
  if (error instanceof AggregateError && error.errors.length > 0) {
    details.push(
      `causes: ${error.errors
        .map((cause) => formatError(cause, seen))
        .join('; ')}`,
    );
  }
  if (Object.hasOwn(error, 'cleanupError')) {
    const cleanup = (error as Error & { cleanupError: unknown }).cleanupError;
    details.push(`cleanup failed: ${formatError(cleanup, seen)}`);
  }

  return details.length === 0 ? message : `${message}; ${details.join('; ')}`;
}

export function errorMessage(error: unknown): string {
  return formatError(error, new Set());
}

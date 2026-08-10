import { ProvisioningError } from '../errors';
import {
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  formatCommandFailure,
} from './command';
import type { ErrorFactory } from './parse';

// Captured output is read under the C locale so stderr matching (e.g. git's
// "No such section") stays stable regardless of the host's language.
const CAPTURE_ENV = { LC_ALL: 'C' } as const;

/**
 * Run `<command> <args>`, throwing on a non-zero exit and returning the completed
 * result on success. `options` selects streamed (`stdout`/`stderr` `'inherit'`)
 * or captured stdio, an optional failure `fallback` (callers pass a redacted
 * `failure` when the args carry secrets), and `raise` for the error class —
 * `ProvisioningError` by default, so the document module can report its own
 * without re-implementing the guard. Generalized over the binary name so every
 * per-tool runner shares one non-zero check.
 */
export async function runProcessStep(
  run: CommandRunner,
  command: string,
  args: readonly string[],
  failure: string,
  options?: CommandOptions & {
    readonly fallback?: string;
    readonly raise?: ErrorFactory;
  },
): Promise<CommandResult> {
  const { fallback, raise, ...runOptions } = options ?? {};
  const result = await run.run(command, args, runOptions);
  if (result.code !== 0) {
    const message = formatCommandFailure(failure, result, fallback);
    throw raise ? raise(message) : new ProvisioningError(message);
  }
  return result;
}

/**
 * Run `<command> <args>` capturing output under a pinned locale, returning the
 * result for the caller to inspect so locale-sensitive parsing stays
 * deterministic.
 */
export function runProcessCapture(
  run: CommandRunner,
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  return run.run(command, args, { env: CAPTURE_ENV });
}

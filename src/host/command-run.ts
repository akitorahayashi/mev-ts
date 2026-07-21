import { ProvisioningError } from '../errors';
import {
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  formatCommandFailure,
} from './command';

// Captured output is read under the C locale so stderr matching (e.g. git's
// "No such section") stays stable regardless of the host's language.
const CAPTURE_ENV = { LC_ALL: 'C' } as const;

/**
 * Run `<command> <args>`, throwing a ProvisioningError built from `failure` on a
 * non-zero exit and returning the completed result on success. `options` selects
 * streamed (`stdout`/`stderr` `'inherit'`) or captured stdio and an optional
 * failure `fallback`; callers pass a redacted `failure` when the args carry
 * secrets. Generalized over the binary name so per-tool runners (`git`, `gh`)
 * share one non-zero guard.
 */
export async function runProcessStep(
  run: CommandRunner,
  command: string,
  args: readonly string[],
  failure: string,
  options?: CommandOptions & { readonly fallback?: string },
): Promise<CommandResult> {
  const { fallback, ...runOptions } = options ?? {};
  const result = await run.run(command, args, runOptions);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(failure, result, fallback),
    );
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

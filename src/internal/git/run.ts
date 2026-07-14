import { ProvisioningError } from '../../errors';
import {
  type CommandResult,
  type CommandRunner,
  formatCommandFailure,
} from '../../host/command';

// Captured git output is read under the C locale so stderr matching (e.g. git's
// "No such section") stays stable regardless of the host's language.
const PARSE_ENV = { LC_ALL: 'C' } as const;

/**
 * Run `git <args>` with inherited stdio (streamed to the terminal), throwing a
 * ProvisioningError on non-zero. `label` defaults to the argv; callers pass a
 * redacted label when the args carry secrets (e.g. a clone URL).
 */
export async function runStep(
  run: CommandRunner,
  args: readonly string[],
  label = `git ${args.join(' ')}`,
): Promise<void> {
  const result = await run.run('git', args, {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(
        `${label} failed`,
        result,
        'see command output above',
      ),
    );
  }
}

/**
 * Run `git <args>` capturing output under a pinned locale, returning the result
 * for the caller to inspect. Locale-sensitive parsing stays deterministic.
 */
export async function runCapture(
  run: CommandRunner,
  args: readonly string[],
): Promise<CommandResult> {
  return run.run('git', args, { env: PARSE_ENV });
}

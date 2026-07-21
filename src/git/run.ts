import type { CommandResult, CommandRunner } from '../host/command';
import { runProcessCapture, runProcessStep } from '../host/command-run';

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
  await runProcessStep(run, 'git', args, `${label} failed`, {
    stdout: 'inherit',
    stderr: 'inherit',
    fallback: 'see command output above',
  });
}

/**
 * Run `git <args>` capturing output under a pinned locale, returning the result
 * for the caller to inspect. Locale-sensitive parsing stays deterministic.
 */
export function runCapture(
  run: CommandRunner,
  args: readonly string[],
): Promise<CommandResult> {
  return runProcessCapture(run, 'git', args);
}

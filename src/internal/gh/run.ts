import type { CommandResult, CommandRunner } from '../../host/command';
import { runProcessStep } from '../../host/command-run';

/**
 * Run `gh <args>`, throwing a labeled ProvisioningError on non-zero and
 * returning the captured result on success. `label` is the full failure prefix
 * (it already reads as a failed operation), passed straight through to the
 * shared process runner.
 */
export function runStep(
  run: CommandRunner,
  args: readonly string[],
  label: string,
): Promise<CommandResult> {
  return runProcessStep(run, 'gh', args, label);
}

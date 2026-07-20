import { ProvisioningError } from '../../errors';
import {
  type CommandResult,
  type CommandRunner,
  formatCommandFailure,
} from '../../host/command';

/**
 * Run `gh <args>`, throwing a labeled ProvisioningError on non-zero and
 * returning the captured result on success. Factors the non-zero →
 * ProvisioningError guard the label operations repeat, mirroring the capture
 * helper in `git/run.ts`.
 */
export async function runStep(
  run: CommandRunner,
  args: readonly string[],
  label: string,
): Promise<CommandResult> {
  const result = await run.run('gh', args);
  if (result.code !== 0) {
    throw new ProvisioningError(formatCommandFailure(label, result));
  }
  return result;
}

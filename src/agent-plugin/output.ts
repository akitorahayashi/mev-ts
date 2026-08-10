import { ProvisioningError } from '../errors';
import type { CommandRunner } from '../host/command';
import { formatCommandFailure } from '../host/command';
import { runProcessCapture } from '../host/command-run';
import { parseJsonLabeled } from '../host/parse';

export async function capturePluginJson(
  run: CommandRunner,
  command: string,
  args: readonly string[],
  label: string,
): Promise<unknown> {
  const result = await runProcessCapture(run, command, args);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`${label} failed`, result),
    );
  }
  return parseJsonLabeled(result.stdout, `${label} output`);
}

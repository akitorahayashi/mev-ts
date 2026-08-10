import { errorMessage, ProvisioningError } from '../errors';
import type { CommandRunner } from '../host/command';
import { formatCommandFailure } from '../host/command';
import { runProcessCapture } from '../host/command-run';

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
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new ProvisioningError(
      `${label} returned invalid JSON: ${errorMessage(error)}`,
    );
  }
}

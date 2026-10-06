import { ProvisioningError } from '../errors';
import type { CommandRunner } from '../host/command';
import { formatCommandFailure } from '../host/command';
import { runProcessCapture } from '../host/command-run';
import { type ErrorFactory, parseJsonLabeled } from '../host/parse';
import { noninteractiveRunner } from './command';

export async function capturePluginJson(
  run: CommandRunner,
  command: string,
  args: readonly string[],
  label: string,
  raise: ErrorFactory = (message) => new ProvisioningError(message),
): Promise<unknown> {
  const result = await runProcessCapture(
    noninteractiveRunner(run),
    command,
    args,
  );
  if (result.code !== 0) {
    throw raise(formatCommandFailure(`${label} failed`, result));
  }
  return parseJsonLabeled(result.stdout, `${label} output`, raise);
}

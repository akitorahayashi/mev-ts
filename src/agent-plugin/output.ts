import { ProvisioningError } from '../errors';
import { formatCommandFailure } from '../host/command';
import { runProcessCapture } from '../host/command-run';
import type { Context } from '../host/context';
import { type ErrorFactory, parseJsonLabeled } from '../host/parse';
import { noninteractiveRunner } from './command';

export async function capturePluginJson(
  context: Context,
  command: string,
  args: readonly string[],
  label: string,
  raise: ErrorFactory = (message) => new ProvisioningError(message),
): Promise<unknown> {
  const result = await runProcessCapture(
    noninteractiveRunner(context),
    command,
    args,
  );
  if (result.code !== 0) {
    throw raise(formatCommandFailure(`${label} failed`, result));
  }
  return parseJsonLabeled(result.stdout, `${label} output`, raise);
}

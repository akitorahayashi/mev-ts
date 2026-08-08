import { ProvisioningError } from '../errors';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';
import type { PnpmRuntime } from './environment';

export async function runPnpm(
  context: Context,
  runtime: PnpmRuntime,
  args: readonly string[],
  errorLabel: string,
): Promise<string> {
  const [command, ...prefix] = runtime.exec;
  if (!command) {
    throw new ProvisioningError('pnpm runtime produced an empty exec prefix.');
  }
  const result = await runProcessStep(
    context.commands,
    command,
    [...prefix, ...args],
    errorLabel,
    runtime.options,
  );
  return result.stdout;
}

export async function add(
  context: Context,
  runtime: PnpmRuntime,
  spec: string,
): Promise<void> {
  await runPnpm(
    context,
    runtime,
    ['add', '-g', spec],
    `pnpm add -g failed for ${spec}`,
  );
}

export async function remove(
  context: Context,
  runtime: PnpmRuntime,
  name: string,
): Promise<void> {
  await runPnpm(
    context,
    runtime,
    ['remove', '-g', name],
    `pnpm remove -g failed for ${name}`,
  );
}

import { ProvisioningError } from '../errors';
import { type CommandOptions, formatCommandFailure } from '../host/command';
import type { Context } from '../host/context';

/**
 * The environment pipx runs under: brew's bin on PATH ahead of the inherited
 * one, so the brew-managed pipx and its python are used. Throws when brew cannot
 * report its prefix.
 */
export async function brewEnv(context: Context): Promise<CommandOptions> {
  const result = await context.commands.run('brew', ['--prefix']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('brew --prefix failed', result),
    );
  }
  const prefix = result.stdout.trim();
  const base = context.basePath;
  return { env: { PATH: [`${prefix}/bin`, base].filter(Boolean).join(':') } };
}

/**
 * The directory pipx stores tool venvs under, queried from pipx itself so the
 * PIPX_HOME/default resolution is owned by pipx rather than re-derived here.
 */
export async function localVenvs(
  context: Context,
  options: CommandOptions,
): Promise<string> {
  const result = await context.commands.run(
    'pipx',
    ['environment', '--value', 'PIPX_LOCAL_VENVS'],
    options,
  );
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('pipx environment failed', result),
    );
  }
  return result.stdout.trim();
}

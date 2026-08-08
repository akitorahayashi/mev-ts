import { join } from 'node:path';
import { ProvisioningError } from '../errors';
import type { CommandOptions } from '../host/command';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';

/**
 * How every pnpm invocation runs: through `fnm exec --using=default` so pnpm
 * spawns the fnm-managed default node, against the brew-installed pnpm binary
 * addressed by absolute path, with PNPM_HOME pinned to pnpm's macOS default so
 * the global store location never depends on the caller's shell setup.
 */
export interface PnpmRuntime {
  readonly options: CommandOptions;
  readonly exec: readonly string[];
}

/**
 * Resolve the runtime once per activation. Verifies the fnm default node
 * up front so a missing runtime fails with one clear step instead of a
 * confusing error from the first package command.
 */
export async function pnpmRuntime(context: Context): Promise<PnpmRuntime> {
  const result = await runProcessStep(
    context.commands,
    'brew',
    ['--prefix'],
    'brew --prefix failed',
  );
  const prefix = result.stdout.trim();
  if (!prefix) {
    throw new ProvisioningError(
      'brew --prefix reported an empty prefix; cannot locate the pnpm binary.',
    );
  }
  const pnpmHome = join(context.home, 'Library/pnpm');
  const options: CommandOptions = {
    env: {
      PNPM_HOME: pnpmHome,
      // pnpm 11 places global binaries under $PNPM_HOME/bin and refuses every
      // global command — including `ls -g` — when that directory is not on
      // PATH; pnpm 10 used $PNPM_HOME itself, so both are present. Homebrew's
      // bin stays ahead of the user-managed global binaries.
      PATH: [`${prefix}/bin`, `${pnpmHome}/bin`, pnpmHome, context.basePath]
        .filter(Boolean)
        .join(':'),
    },
  };
  await runProcessStep(
    context.commands,
    'fnm',
    ['exec', '--using=default', '--', 'node', '--version'],
    'node runtime verification failed',
    options,
  );
  return {
    options,
    exec: ['fnm', 'exec', '--using=default', '--', `${prefix}/bin/pnpm`],
  };
}

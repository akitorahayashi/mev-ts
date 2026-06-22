import type { CAC } from 'cac';
import { CommandLineError } from '../../errors';
import { deployLabels, resetLabels } from '../../internal/gh/labels';
import { createContext } from '../../runtime/context';

interface LabelCommandOptions {
  repo?: string | boolean;
}

function resolveRepo(value: string | boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new CommandLineError(
    'Option --repo requires a value: --repo <owner/repo>.',
  );
}

export function registerInternalGhCommands(program: CAC): void {
  program
    .command(
      'gh labels deploy',
      'Deploy the mev label catalog to a GitHub repository.',
    )
    .option(
      '--repo <owner/repo>',
      'Target repository (defaults to current repo).',
    )
    .action(async (options: LabelCommandOptions): Promise<void> => {
      const context = createContext({ overwrite: false });
      await deployLabels(context.commands, resolveRepo(options.repo));
    });

  program
    .command('gh labels reset', 'Delete all labels from a GitHub repository.')
    .option(
      '--repo <owner/repo>',
      'Target repository (defaults to current repo).',
    )
    .action(async (options: LabelCommandOptions): Promise<void> => {
      const context = createContext({ overwrite: false });
      await resetLabels(context.commands, resolveRepo(options.repo));
    });
}

import type { CAC } from 'cac';
import { deployLabels, resetLabels } from '../../internal/gh/labels';
import { createContext } from '../../runtime/context';

interface LabelCommandOptions {
  repo?: string;
}

export function registerInternalGhCommands(program: CAC): void {
  program
    .command(
      'internal gh labels deploy',
      'Deploy the mev label catalog to a GitHub repository.',
    )
    .option(
      '--repo <owner/repo>',
      'Target repository (defaults to current repo).',
    )
    .action(async (options: LabelCommandOptions): Promise<void> => {
      const context = createContext({ overwrite: false });
      await deployLabels(context.commands, options.repo);
    });

  program
    .command(
      'internal gh labels reset',
      'Delete all labels from a GitHub repository.',
    )
    .option(
      '--repo <owner/repo>',
      'Target repository (defaults to current repo).',
    )
    .action(async (options: LabelCommandOptions): Promise<void> => {
      const context = createContext({ overwrite: false });
      await resetLabels(context.commands, options.repo);
    });
}

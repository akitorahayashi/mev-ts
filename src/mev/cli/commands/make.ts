import type { CAC } from 'cac';
import { runMake } from '../../app/make';
import type { CommandOutcome } from '../program';

interface MakeOptions {
  plan?: boolean;
  overwrite?: boolean;
}

export function registerMakeCommand(program: CAC): void {
  program
    .command('make <tags...>', 'Apply provisioning for one or more tags.')
    .alias('mk')
    .option('--plan', 'Show what would change without applying.')
    .option('--overwrite', 'Replace unmanaged files when linking configs.')
    .action(async (...inputs: unknown[]): Promise<CommandOutcome> => {
      // cac spreads a variadic into separate positional arguments and appends
      // the options object last, so the tags are everything before it.
      const options = (inputs.pop() ?? {}) as MakeOptions;
      const tags = inputs as string[];

      const result = await runMake({
        tags,
        plan: options.plan ?? false,
        overwrite: options.overwrite ?? false,
      });

      process.stdout.write(`${result.report}\n`);
      return { failed: result.failed };
    });
}

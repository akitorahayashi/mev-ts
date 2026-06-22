import type { CAC } from 'cac';
import { runMake } from '../../app/make';
import type { CommandOutcome } from '../program';
import { createProgressBar } from '../render/bar';
import { renderReports } from '../render/report';

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
      const options = (inputs.pop() ?? {}) as MakeOptions;
      const tags = inputs as string[];
      const plan = options.plan ?? false;

      let bar: ReturnType<typeof createProgressBar> | undefined;

      const result = await runMake({
        tags,
        plan,
        overwrite: options.overwrite ?? false,
        onStart(total) {
          if (total > 0) bar = createProgressBar(total);
        },
        onProgress(report) {
          bar?.tick(report.id);
        },
      });

      bar?.stop();
      process.stdout.write(`\n${renderReports(result.reports, { plan })}\n`);
      return { failed: result.failed };
    });
}

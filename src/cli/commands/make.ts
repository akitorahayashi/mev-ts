import type { CAC, CommandOutcome } from 'cli-kit';
import { runMake } from '../../app/make';
import { renderOutcomes } from '../tty/outcomes';
import { createProgressBar } from '../tty/progress';

interface MakeOptions {
  plan?: boolean;
  overwrite?: boolean;
}

export function registerMakeCommand(program: CAC): void {
  program
    .command('make <tags...>', 'Apply provisioning for one or more tags.')
    .alias('mk')
    .option('--plan', 'Show what would change without applying.')
    .option('-o, --overwrite', 'Replace unmanaged files when linking configs.')
    .action(async (...inputs: unknown[]): Promise<CommandOutcome> => {
      const options = (inputs.pop() ?? {}) as MakeOptions;
      const tags = inputs as string[];
      const plan = options.plan ?? false;

      let bar: ReturnType<typeof createProgressBar> | undefined;

      try {
        const result = await runMake({
          tags,
          plan,
          overwrite: options.overwrite ?? false,
          onStart(total) {
            if (total > 0) bar = createProgressBar(total);
          },
          onProgress() {
            bar?.tick();
          },
        });

        bar?.stop();
        process.stdout.write(`\n${renderOutcomes(result.reports, { plan })}\n`);
        return { failed: result.failed };
      } finally {
        // Guarantee the spinner interval is cleared even if runMake throws, so
        // the event loop is not kept alive and the cursor is not left dirty.
        bar?.stop();
      }
    });
}

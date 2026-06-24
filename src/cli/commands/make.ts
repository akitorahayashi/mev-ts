import type { CAC, CommandOutcome } from 'cli-kit';
import { runMake } from '../../provisioning/run';
import {
  renderDeployLine,
  renderGroups,
  renderHeader,
  renderSuccess,
} from '../tty/makelog';
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
      const isTTY = process.stdout.isTTY ?? false;
      const out = (text: string) => process.stdout.write(text);

      let bar: ReturnType<typeof createProgressBar> | undefined;

      try {
        const report = await runMake({
          tags,
          plan,
          overwrite: options.overwrite ?? false,
          onDeploy(result) {
            const line = renderDeployLine(result, plan, isTTY);
            if (line) out(`${line}\n`);
          },
          onHeader(selection) {
            out(`${renderHeader(selection)}\n`);
          },
          onInstallStart(total) {
            if (total > 0 && isTTY && !plan) {
              out('\n');
              bar = createProgressBar(total);
            }
          },
          onInstallTick() {
            bar?.tick();
          },
        });

        bar?.stop();
        out(`\n${renderGroups(report.groups, { plan, isTTY })}\n`);
        if (!report.failed) {
          out(`\n${renderSuccess(isTTY)}\n`);
        }
        return { failed: report.failed };
      } finally {
        // Guarantee the spinner interval is cleared even if runMake throws, so
        // the event loop is not kept alive and the cursor is not left dirty.
        bar?.stop();
      }
    });
}

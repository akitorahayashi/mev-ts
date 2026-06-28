import { Command, Option } from 'clipanion';
import { createProgressBar } from 'tty-prog';
import { runMake } from '../../provisioning/run';
import {
  renderDeployLine,
  renderGroups,
  renderHeader,
  renderMakeReport,
} from '../tty/makelog';

export class MakeCommand extends Command {
  static override paths = [['make'], ['mk']];
  static override usage = Command.Usage({
    description: 'Apply provisioning for one or more tags. [aliases: mk]',
  });

  tags = Option.Rest({ required: 1 });
  plan = Option.Boolean('--plan', false, {
    description: 'Show what would change without applying.',
  });
  overwrite = Option.Boolean('-o,--overwrite', false, {
    description: 'Replace unmanaged files when linking configs.',
  });

  async execute(): Promise<number> {
    const { plan, overwrite } = this;
    const isTTY = process.stdout.isTTY ?? false;
    const out = (text: string) => process.stdout.write(text);
    const startedAt = Date.now();

    let bar: ReturnType<typeof createProgressBar> | undefined;

    try {
      const report = await runMake({
        tags: this.tags,
        plan,
        overwrite,
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
            bar = createProgressBar({
              total,
              isTty: isTTY,
              stream: process.stdout,
            });
          }
        },
        onInstallTokenStart(token, stage) {
          bar?.setLabel(`${stage} ${token.kind} ${token.name}`);
        },
        onInstallTick() {
          bar?.advance();
        },
      });

      bar?.finish();
      out(`\n${renderGroups(report.groups, { plan, isTTY })}\n`);
      out(
        `\n${renderMakeReport(report, {
          plan,
          isTTY,
          durationMs: Date.now() - startedAt,
        })}\n`,
      );
      return report.failed ? 1 : 0;
    } finally {
      // Guarantee the spinner interval is cleared even if runMake throws, so
      // the event loop is not kept alive and the cursor is not left dirty.
      bar?.finish();
    }
  }
}

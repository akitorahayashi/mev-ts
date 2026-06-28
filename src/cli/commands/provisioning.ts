import { createProgressBar } from 'tty-prog';
import {
  type MakeReport,
  type MakeRequest,
  runMake,
} from '../../provisioning/run';
import {
  renderDeployLine,
  renderGroups,
  renderHeader,
  renderMakeReport,
} from '../tty/makelog';

export type ProvisioningRun = (request: MakeRequest) => Promise<MakeReport>;

interface ProvisioningRunOptions {
  readonly tags: readonly string[];
  readonly overwrite: boolean;
  readonly intro?: string;
  readonly footer?: (report: MakeReport) => readonly string[] | undefined;
  readonly run?: ProvisioningRun;
}

export async function executeProvisioningRun(
  options: ProvisioningRunOptions,
): Promise<number> {
  const isTTY = process.stdout.isTTY ?? false;
  const out = (text: string) => process.stdout.write(text);
  const startedAt = Date.now();
  const run = options.run ?? runMake;

  if (options.intro) {
    out(`${options.intro}\n`);
  }

  let bar: ReturnType<typeof createProgressBar> | undefined;

  try {
    const report = await run({
      tags: options.tags,
      overwrite: options.overwrite,
      onDeploy(result) {
        const line = renderDeployLine(result, isTTY);
        if (line) out(`${line}\n`);
      },
      onHeader(selection) {
        out(`${renderHeader(selection)}\n`);
      },
      onInstallStart(total) {
        if (total > 0 && isTTY) {
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
    bar = undefined;
    out(`\n${renderGroups(report.groups, { isTTY })}\n`);
    out(
      `\n${renderMakeReport(report, {
        isTTY,
        durationMs: Date.now() - startedAt,
        footer: options.footer?.(report),
      })}\n`,
    );
    return report.failed ? 1 : 0;
  } finally {
    // Guarantee the spinner interval is cleared even if runMake throws, so
    // the event loop is not kept alive and the cursor is not left dirty.
    bar?.finish();
  }
}

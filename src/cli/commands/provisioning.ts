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
import { resolveIsTTY } from '../tty/style';

export type ProvisioningRun = (request: MakeRequest) => Promise<MakeReport>;

interface ProvisioningRunOptions {
  readonly tags: readonly string[];
  readonly overwrite: boolean;
  readonly intro?: string;
  readonly footer?: (report: MakeReport) => readonly string[] | undefined;
  readonly run?: ProvisioningRun;
  readonly out?: (text: string) => void;
  readonly isTTY?: boolean;
}

export async function executeProvisioningRun(
  options: ProvisioningRunOptions,
): Promise<number> {
  const isTTY = options.isTTY ?? resolveIsTTY();
  const out =
    options.out ??
    ((text: string) => {
      process.stdout.write(text);
    });
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
      onInstallTokenStart(token) {
        bar?.setLabel(`installing ${token.kind} ${token.name}`);
      },
      onInstallTick() {
        // Clear the label so it only ever names an in-flight install; present
        // tokens and completed installs advance the bar unlabeled.
        bar?.setLabel('');
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

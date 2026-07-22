import { createProgressBar } from 'tty-prog';
import { createContext } from '../host/context';
import {
  type MakeReport,
  type MakeRequest,
  runMake,
} from '../provisioning/run';
import {
  type ActivationProgress,
  createActivationProgress,
} from './tty/activation-progress';
import {
  renderDeployLine,
  renderHeader,
  renderMakeReport,
} from './tty/makelog';
import { resolveIsTTY } from './tty/style';

export type ProvisioningRun = (request: MakeRequest) => Promise<MakeReport>;

interface ProvisioningRunOptions {
  readonly selectors: readonly string[];
  readonly intro?: string;
  readonly footer?: (report: MakeReport) => readonly string[] | undefined;
  readonly run?: ProvisioningRun;
  readonly out: (text: string) => void;
  readonly isTTY?: boolean;
  /** Animated-progress sink; defaults to the process stdout stream. */
  readonly stream?: NodeJS.WriteStream;
}

export async function executeProvisioningRun(
  options: ProvisioningRunOptions,
): Promise<number> {
  const isTTY = options.isTTY ?? resolveIsTTY();
  const out = options.out;
  const stream = options.stream ?? process.stdout;
  const startedAt = Date.now();
  const run =
    options.run ??
    ((request: MakeRequest) => runMake(request, createContext()));

  if (options.intro) {
    out(`${options.intro}\n`);
  }

  let bar: ReturnType<typeof createProgressBar> | undefined;
  let activation: ActivationProgress | undefined;
  let nameWidth = 0;

  const finishInstallBar = () => {
    bar?.finish();
    bar = undefined;
  };

  try {
    const report = await run({
      selectors: options.selectors,
      onDeploy(result) {
        const line = renderDeployLine(result, isTTY);
        if (line) out(`${line}\n`);
      },
      onHeader(selection) {
        nameWidth = Math.max(
          0,
          ...selection.targetNames.map((name) => name.length),
        );
        out(`${renderHeader(selection)}\n`);
      },
      onInstallStart(total) {
        if (total > 0 && isTTY) {
          out('\n');
          // The progress bar needs a real WriteStream (isTTY/columns/cursor).
          // The stream is injected (defaulting to process.stdout) so the TTY
          // path is testable with a fake terminal stream.
          bar = createProgressBar({
            total,
            isTty: isTTY,
            stream,
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
      onActivationPhaseStart(event) {
        finishInstallBar();
        activation = createActivationProgress({
          isTTY,
          out,
          stream,
          nameWidth,
        });
        activation.start(event);
      },
      onActivationStart(event) {
        activation?.startActivation(event);
      },
      onActivationTargetComplete(group) {
        activation?.completeTarget(group);
      },
    });

    finishInstallBar();
    activation?.finish();
    activation = undefined;
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
    finishInstallBar();
    activation?.finish();
  }
}

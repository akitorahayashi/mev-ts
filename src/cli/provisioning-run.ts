import type { Writable } from 'node:stream';
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
  /** Upgrade mode (`--upgrade`): refresh installed latest-assumed items. */
  readonly upgrade?: boolean;
  readonly intro?: string;
  readonly footer?: (report: MakeReport) => readonly string[] | undefined;
  readonly run?: ProvisioningRun;
  /**
   * The command's output sink, and the sole authority on TTY-ness: plain lines,
   * the animated progress, and the decision to style them all resolve from this
   * one object, so an injected context never gets output styled for a terminal
   * it is not writing to.
   */
  readonly stream: Writable & { readonly isTTY?: boolean };
}

export async function executeProvisioningRun(
  options: ProvisioningRunOptions,
): Promise<number> {
  const { stream } = options;
  const isTTY = resolveIsTTY(stream);
  const out = (text: string) => {
    stream.write(text);
  };
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
      upgrade: options.upgrade,
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
          bar = createProgressBar({
            total,
            isTty: isTTY,
            // The bar reads terminal facts (columns, cursor) that `Writable`
            // does not declare. Reaching this branch already required
            // `isTTY`, so the sink is a terminal stream.
            stream: stream as NodeJS.WriteStream,
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
      onActivationPhaseStart() {
        finishInstallBar();
        activation = createActivationProgress({
          isTTY,
          out,
          stream,
          nameWidth,
        });
        activation.start();
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

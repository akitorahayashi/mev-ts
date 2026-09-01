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
import { renderMakeReport, renderPackageReport } from './tty/makelog';
import { resolveIsTTY } from './tty/style';

export type ProvisioningRun = (request: MakeRequest) => Promise<MakeReport>;

interface ProvisioningRunOptions {
  readonly selectors: readonly string[];
  /** Upgrade selected Homebrew packages and installed latest-assumed items. */
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
      onEvent(event) {
        switch (event.type) {
          case 'selection':
            nameWidth = Math.max(
              0,
              ...event.selection.targetNames.map((name) => name.length),
            );
            break;
          case 'deploy-complete':
            break;
          case 'package-phase-start':
            if (event.total > 0 && isTTY) {
              out('\n');
              bar = createProgressBar({
                total: event.total,
                isTty: isTTY,
                stream: stream as NodeJS.WriteStream,
              });
            }
            break;
          case 'package-start': {
            const label =
              event.action === 'install' ? 'installing' : 'upgrading';
            bar?.setLabel(`${label} ${event.token.kind} ${event.token.name}`);
            break;
          }
          case 'package-tick':
            bar?.setLabel('');
            bar?.advance();
            break;
          case 'package-phase-complete': {
            finishInstallBar();
            const packages = renderPackageReport(event.reports, { isTTY });
            if (packages) out(`\n${packages}\n`);
            break;
          }
          case 'activation-phase-start':
            finishInstallBar();
            activation = createActivationProgress({
              isTTY,
              out,
              stream,
              nameWidth,
            });
            activation.start();
            break;
          case 'activation-start':
            activation?.startActivation(event);
            break;
          case 'target-complete':
            activation?.completeTarget(event.group);
            break;
        }
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

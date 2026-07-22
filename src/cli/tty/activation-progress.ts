import type { Writable } from 'node:stream';
import { activationLine } from '../../provisioning/group-outcome';
import type {
  ActivationGroupReport,
  ActivationPhaseEvent,
  ActivationStartEvent,
} from '../../provisioning/run';
import { renderTargetCompletionLine } from './makelog';
import { createTransientLine } from './transient-line';

interface ActivationProgressOptions {
  readonly isTTY: boolean;
  readonly out: (text: string) => void;
  readonly stream: Writable;
  /** Widest target name, so completion columns align. */
  readonly nameWidth?: number;
}

function startLine(event: ActivationStartEvent): string {
  return `${event.targetName}  ${activationLine(event.activation)}`;
}

/** The once-only "Activating targets" banner shared by both progress variants. */
function createBanner(out: (text: string) => void): () => void {
  let shown = false;
  return () => {
    if (shown) return;
    shown = true;
    out('\nActivating targets\n');
  };
}

export interface ActivationProgress {
  start(event: ActivationPhaseEvent): void;
  startActivation(event: ActivationStartEvent): void;
  completeTarget(group: ActivationGroupReport): void;
  finish(): void;
}

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createActivationProgress(
  options: ActivationProgressOptions,
): ActivationProgress {
  if (!options.isTTY) {
    return createLineActivationProgress(options);
  }
  return createTTYActivationProgress(options);
}

function createLineActivationProgress(
  options: ActivationProgressOptions,
): ActivationProgress {
  return {
    start: createBanner(options.out),
    startActivation(event) {
      options.out(
        `Activating ${event.targetName}: ${activationLine(event.activation)}\n`,
      );
    },
    completeTarget(group) {
      options.out(`${renderTargetCompletionLine(group, { isTTY: false })}\n`);
    },
    finish() {},
  };
}

function createTTYActivationProgress(
  options: ActivationProgressOptions,
): ActivationProgress {
  let active: ActivationStartEvent | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const line = createTransientLine(options.stream);

  const renderActive = () => {
    if (!active) return;
    const spinner = frames[frame % frames.length];
    frame += 1;
    line.render(`${spinner} ${startLine(active)}`);
  };

  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const startTimer = () => {
    if (timer) return;
    timer = setInterval(renderActive, 80);
  };

  return {
    start: createBanner(options.out),
    startActivation(event) {
      active = event;
      renderActive();
      startTimer();
    },
    completeTarget(group) {
      stopTimer();
      if (active) {
        line.clear();
        active = undefined;
      }
      options.out(
        `${renderTargetCompletionLine(group, {
          isTTY: true,
          nameWidth: options.nameWidth,
        })}\n`,
      );
    },
    finish() {
      stopTimer();
      if (!active) return;
      line.clear();
      active = undefined;
    },
  };
}

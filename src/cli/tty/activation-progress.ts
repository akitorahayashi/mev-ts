import { clearLine, cursorTo } from 'node:readline';
import type { Writable } from 'node:stream';
import { activationLine } from '../../provisioning/group-outcome';
import type {
  ActivationGroupReport,
  ActivationPhaseEvent,
  ActivationStartEvent,
} from '../../provisioning/run';
import { renderTargetCompletionLine } from './makelog';

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
  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      options.out('\nActivating targets\n');
    },
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
  let started = false;
  let active: ActivationStartEvent | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const clearActiveLine = () => {
    clearLine(options.stream, 0);
    cursorTo(options.stream, 0);
  };

  const renderActive = () => {
    if (!active) return;
    clearActiveLine();
    const spinner = frames[frame % frames.length];
    frame += 1;
    options.stream.write(`${spinner} ${startLine(active)}`);
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
    start() {
      if (started) return;
      started = true;
      options.out('\nActivating targets\n');
    },
    startActivation(event) {
      active = event;
      renderActive();
      startTimer();
    },
    completeTarget(group) {
      stopTimer();
      if (active) {
        clearActiveLine();
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
      clearActiveLine();
      active = undefined;
    },
  };
}

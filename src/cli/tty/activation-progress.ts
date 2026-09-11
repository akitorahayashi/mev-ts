import type { Writable } from 'node:stream';
import { activationLine } from '../../provisioning/group-outcome';
import type { ActivationGroupReport, MakeEvent } from '../../provisioning/run';
import { renderTargetCompletionLine } from './makelog';
import { createTransientLine } from './transient-line';

interface ActivationProgressOptions {
  readonly isTTY: boolean;
  readonly out: (text: string) => void;
  readonly stream: Writable;
  /** Widest target name, so completion columns align. */
  readonly nameWidth?: number;
}

type ActivationStartEvent = Omit<
  Extract<MakeEvent, { readonly type: 'activation-start' }>,
  'type'
>;

type ActivationProgressEvent = Omit<
  Extract<MakeEvent, { readonly type: 'activation-progress' }>,
  'type'
>;

interface ActiveActivation {
  readonly targetName: string;
  readonly subject: string;
  readonly action?: ActivationProgressEvent['activity']['action'];
}

const activityLabels = {
  check: 'checking',
  install: 'installing',
  update: 'updating',
  verify: 'verifying',
} as const satisfies Record<
  ActivationProgressEvent['activity']['action'],
  string
>;

function activeLine(active: ActiveActivation): string {
  const operation = active.action ? `${activityLabels[active.action]} ` : '';
  return `${active.targetName}  ${operation}${active.subject}`;
}

function createBanner(out: (text: string) => void): () => void {
  let shown = false;
  return () => {
    if (shown) return;
    shown = true;
    out('\nApplying resources\n');
  };
}

export interface ActivationProgress {
  start(): void;
  startActivation(event: ActivationStartEvent): void;
  updateActivation(event: ActivationProgressEvent): void;
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
    start() {},
    startActivation() {},
    updateActivation() {},
    completeTarget(group) {
      options.out(`${renderTargetCompletionLine(group, { isTTY: false })}\n`);
    },
    finish() {},
  };
}

function createTTYActivationProgress(
  options: ActivationProgressOptions,
): ActivationProgress {
  let active: ActiveActivation | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const line = createTransientLine(options.stream);

  const renderActive = () => {
    if (!active) return;
    const spinner = frames[frame % frames.length];
    frame += 1;
    line.render(`${spinner} ${activeLine(active)}`);
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
      active = {
        targetName: event.targetName,
        subject: activationLine(event.activation),
      };
      renderActive();
      startTimer();
    },
    updateActivation(event) {
      active = {
        targetName: event.targetName,
        subject: event.activity.subject,
        action: event.activity.action,
      };
      renderActive();
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

import type { Writable } from 'node:stream';
import { activationLine } from '../../provisioning/group-outcome';
import type { ActivationGroupReport, MakeEvent } from '../../provisioning/run';
import { renderTargetCompletionLine } from './makelog';
import { createTransientBlock } from './transient-block';

interface ActivationProgressOptions {
  readonly isTTY: boolean;
  readonly out: (text: string) => void;
  readonly stream: Writable & { readonly columns?: number };
  readonly now?: () => number;
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

interface ActiveOperation {
  readonly group: string;
  readonly subject: string;
  readonly action: ActivationProgressEvent['activity']['action'];
  readonly startedAt: number;
}

const activityLabels = {
  check: 'checking',
  resolve: 'resolving',
  download: 'downloading',
  apply: 'applying',
  install: 'installing',
  update: 'updating',
  upgrade: 'upgrading',
  enable: 'enabling',
  uninstall: 'uninstalling',
  register: 'registering',
  refresh: 'refreshing',
  remove: 'removing',
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
    updateActivation(event) {
      if (event.activity.operation?.state !== 'started') return;
      options.out(
        `${event.targetName}  ${event.activity.operation.group}  ${activityLabels[event.activity.action]} ${event.activity.subject}\n`,
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
  let active: ActiveActivation | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const block = createTransientBlock(options.stream);
  const now = options.now ?? Date.now;
  const operations = new Map<string, ActiveOperation>();

  const renderActive = () => {
    if (!active) return;
    const spinner = frames[frame % frames.length];
    frame += 1;
    if (operations.size === 0) {
      block.render([`${spinner} ${activeLine(active)}`]);
      return;
    }
    const lines = [...operations.values()]
      .sort((a, b) => a.group.localeCompare(b.group))
      .map(({ group, action, subject, startedAt }) => {
        const seconds = Math.max(0, Math.floor((now() - startedAt) / 1000));
        const prefix = `  ${spinner} ${group}  ${activityLabels[action]} `;
        const suffix = `  ${seconds}s`;
        const columns = options.stream.columns;
        const available =
          columns === undefined
            ? undefined
            : Math.max(1, columns - prefix.length - suffix.length - 1);
        const label =
          available !== undefined && subject.length > available
            ? `${subject.slice(0, available - 1)}…`
            : subject;
        return `${prefix}${label}${suffix}`;
      });
    block.render([activeLine(active), ...lines]);
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
      operations.clear();
      active = {
        targetName: event.targetName,
        subject: activationLine(event.activation),
      };
      renderActive();
      startTimer();
    },
    updateActivation(event) {
      const operation = event.activity.operation;
      if (operation) {
        if (operation.state === 'started') {
          operations.set(operation.id, {
            group: operation.group,
            subject: event.activity.subject,
            action: event.activity.action,
            startedAt: now(),
          });
        } else {
          operations.delete(operation.id);
        }
        renderActive();
        return;
      }
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
        block.clear();
        active = undefined;
      }
      operations.clear();
      options.out(
        `${renderTargetCompletionLine(group, {
          isTTY: true,
        })}\n`,
      );
    },
    finish() {
      stopTimer();
      if (!active) return;
      block.clear();
      active = undefined;
      operations.clear();
    },
  };
}

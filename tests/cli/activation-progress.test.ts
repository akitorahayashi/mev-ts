import { expect, test } from 'bun:test';
import { createActivationProgress } from '../../src/cli/tty/activation-progress';
import type { ActivationAction } from '../../src/provisioning/activation/contract';
import { fakeTtyStream } from '../fixtures/streams';

test('the TTY activation progress renders the in-flight line and a completion line', () => {
  const stream = fakeTtyStream();
  let out = '';
  const progress = createActivationProgress({
    isTTY: true,
    out: (text) => {
      out += text;
    },
    stream: stream as unknown as NodeJS.WriteStream,
  });

  progress.start();
  progress.startActivation({
    targetName: 'git',
    activation: { subject: '~/.gitconfig' },
  });
  progress.updateActivation({
    targetName: 'git',
    activity: { subject: 'Git configuration', action: 'update' },
  });
  progress.completeTarget({
    targetName: 'git',
    blockers: [],
    reports: [
      {
        description: { subject: '~/.gitconfig' },
        outcomes: [
          {
            label: '~/.gitconfig',
            status: 'changed',
            details: ['linked to managed config'],
          },
        ],
      },
    ],
  });
  progress.finish();

  const terminal = stream.output();
  expect(terminal).toContain('git  ~/.gitconfig');
  expect(terminal).toContain('git  updating Git configuration');
  expect(terminal).toMatch(/\[[0-9;]*[JK]/);
  expect(out).toContain('Applying resources');
  const plainOut = Bun.stripANSI(out);
  expect(plainOut).toContain('git');
  expect(plainOut).toContain('changed');
});

test('the non-TTY activation progress writes plain lines only to out', () => {
  const stream = fakeTtyStream();
  let out = '';
  const progress = createActivationProgress({
    isTTY: false,
    out: (text) => {
      out += text;
    },
    stream: stream as unknown as NodeJS.WriteStream,
  });

  progress.start();
  progress.startActivation({
    targetName: 'git',
    activation: { subject: '~/.gitconfig' },
  });
  progress.updateActivation({
    targetName: 'git',
    activity: { subject: 'Git configuration', action: 'update' },
  });
  progress.completeTarget({
    targetName: 'git',
    blockers: [],
    reports: [
      {
        description: { subject: '~/.gitconfig' },
        outcomes: [
          {
            label: '~/.gitconfig',
            status: 'changed',
            details: ['linked to managed config'],
          },
        ],
      },
    ],
  });
  progress.finish();

  expect(stream.output()).toBe('');
  expect(out).toContain('changed   ~/.gitconfig');
});

test('concurrent plugin operations retain their own clocks and clear on completion', () => {
  const stream = fakeTtyStream(100);
  let now = 0;
  const progress = createActivationProgress({
    isTTY: true,
    out: () => {},
    stream: stream as never,
    now: () => now,
  });
  const update = (group: string, state: 'started' | 'finished') =>
    progress.updateActivation({
      targetName: 'coder',
      activity: {
        subject: `${group}-plugin@marketplace`,
        action: 'upgrade',
        operation: { group, id: group, state },
      },
    });
  const visible = () => stream.output().split('\x1b[0J').at(-1) ?? '';

  try {
    progress.startActivation({
      targetName: 'coder',
      activation: { subject: 'agent plugins' },
    });
    update('claude', 'started');
    now = 8000;
    update('codex', 'started');
    expect(visible()).toContain(
      'claude  upgrading claude-plugin@marketplace  8s',
    );
    expect(visible()).toContain(
      'codex  upgrading codex-plugin@marketplace  0s',
    );

    now = 11000;
    update('claude', 'finished');
    expect(visible()).not.toContain('claude-plugin');
    expect(visible()).toContain(
      'codex  upgrading codex-plugin@marketplace  3s',
    );

    progress.startActivation({
      targetName: 'coder',
      activation: { subject: 'next resource' },
    });
    expect(visible()).not.toContain('codex-plugin');
    expect(visible()).toContain('next resource');
  } finally {
    progress.finish();
  }
  expect(visible()).toBe('');
});

test('long plugin names keep the operation and elapsed time visible', () => {
  const stream = fakeTtyStream(60);
  const progress = createActivationProgress({
    isTTY: true,
    out: () => {},
    stream: stream as never,
  });
  try {
    progress.startActivation({
      targetName: 'coder',
      activation: { subject: 'agent plugins' },
    });
    progress.updateActivation({
      targetName: 'coder',
      activity: {
        subject: 'code-incident-resolution@code-incident-resolution',
        action: 'upgrade',
        operation: { group: 'codex', id: 'long', state: 'started' },
      },
    });
    const visible = stream.output().split('\x1b[0J').at(-1) ?? '';
    expect(visible).toContain('codex  upgrading code-incident-');
    expect(visible).toContain('…  0s');
    expect(visible.split('\n\r').every((row) => row.length < 60)).toBe(true);
  } finally {
    progress.finish();
  }
});

test('redirected output logs plugin operation starts once without terminal controls', () => {
  let out = '';
  const stream = fakeTtyStream();
  const progress = createActivationProgress({
    isTTY: false,
    out: (text) => {
      out += text;
    },
    stream: stream as never,
  });
  for (const group of ['claude', 'codex']) {
    for (const state of ['started', 'finished'] as const) {
      progress.updateActivation({
        targetName: 'coder',
        activity: {
          subject: 'xlsx@xlsx',
          action: 'upgrade',
          operation: { group, id: group, state },
        },
      });
    }
  }
  expect(out.split('\n').filter(Boolean)).toHaveLength(2);
  expect(out).toContain('claude  upgrading xlsx@xlsx');
  expect(out).toContain('codex  upgrading xlsx@xlsx');
  expect(out).toBe(Bun.stripANSI(out));
  expect(stream.output()).toBe('');
});

test('parallel release binaries remain visible in stable order and each phase resets its clock', () => {
  const stream = fakeTtyStream(100);
  let now = 0;
  const progress = createActivationProgress({
    isTTY: true,
    out: () => {},
    stream: stream as never,
    now: () => now,
  });
  const update = (
    group: string,
    action: ActivationAction,
    subject: string,
    state: 'started' | 'finished',
  ) =>
    progress.updateActivation({
      targetName: 'rust-cli',
      activity: {
        action,
        subject,
        operation: { group, id: `${group}:${action}`, state },
      },
    });
  const visible = () => stream.output().split('\x1b[0J').at(-1) ?? '';
  try {
    progress.startActivation({
      targetName: 'rust-cli',
      activation: { subject: '~/.cargo/bin release binaries' },
    });
    update('prf', 'resolve', 'latest', 'started');
    now = 8000;
    update('kpv', 'download', 'v0.7.0', 'started');
    expect(visible()).toContain('prf  resolving latest  8s');
    expect(visible()).toContain('kpv  downloading v0.7.0  0s');
    expect(visible().indexOf('kpv')).toBeLessThan(visible().indexOf('prf'));
    now = 11000;
    update('kpv', 'download', 'v0.7.0', 'finished');
    update('kpv', 'verify', 'v0.7.0', 'started');
    expect(visible()).toContain('kpv  verifying v0.7.0  0s');
    expect(visible()).toContain('prf  resolving latest  11s');
    expect(visible()).not.toContain('downloading');
    now = 14000;
    update('prf', 'resolve', 'latest', 'finished');
    expect(visible()).not.toContain('prf');
    expect(visible()).toContain('kpv  verifying v0.7.0  3s');
  } finally {
    progress.finish();
  }
  expect(visible()).toBe('');
});

test('redirected output records release phase starts once as plain lines', () => {
  let out = '';
  const stream = fakeTtyStream();
  const progress = createActivationProgress({
    isTTY: false,
    out: (text) => {
      out += text;
    },
    stream: stream as never,
  });
  const phases = [
    { action: 'check', subject: 'installed version' },
    { action: 'resolve', subject: 'latest' },
    { action: 'download', subject: 'v0.7.0' },
    { action: 'verify', subject: 'v0.7.0' },
    { action: 'apply', subject: 'v0.7.0' },
  ] as const;
  for (const phase of phases) {
    for (const state of ['started', 'finished'] as const) {
      progress.updateActivation({
        targetName: 'rust-cli',
        activity: {
          ...phase,
          operation: { group: 'kpv', id: phase.action, state },
        },
      });
    }
  }
  expect(out).toBe(
    [
      'rust-cli  kpv  checking installed version',
      'rust-cli  kpv  resolving latest',
      'rust-cli  kpv  downloading v0.7.0',
      'rust-cli  kpv  verifying v0.7.0',
      'rust-cli  kpv  applying v0.7.0',
      '',
    ].join('\n'),
  );
  expect(out).toBe(Bun.stripANSI(out));
  expect(stream.output()).toBe('');
});

import { expect, test } from 'bun:test';
import { createActivationProgress } from '../../src/cli/tty/activation-progress';
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
    nameWidth: 5,
  });

  progress.start();
  progress.startActivation({
    targetName: 'git',
    activation: { subject: '~/.gitconfig' },
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

  // The spinner renders the in-flight activation line to the TTY stream and
  // clears it before the completion line is emitted. Match any CSI erase body
  // (`[<params>J|K`) rather than a specific clear code, so tightening the exact
  // reset bytes in transient-line does not break this behavioral assertion.
  const terminal = stream.output();
  expect(terminal).toContain('git  ~/.gitconfig');
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

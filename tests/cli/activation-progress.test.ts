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

  progress.start({ totalTargets: 1 });
  progress.startActivation({
    targetName: 'git',
    activation: {
      verb: 'link',
      source: 'git/.gitconfig',
      dest: '~/.gitconfig',
    },
  });
  progress.completeTarget({
    targetName: 'git',
    blockers: [],
    reports: [
      {
        verb: 'link',
        source: 'git/.gitconfig',
        dest: '~/.gitconfig',
        status: 'changed',
      },
    ],
  });
  progress.finish();

  // The spinner renders the in-flight activation line to the TTY stream and
  // clears it (line-reset sequence) before the completion line is emitted.
  const terminal = stream.output();
  expect(terminal).toContain('link git/.gitconfig -> ~/.gitconfig');
  expect(terminal).toContain('\x1b[2K');
  // The header and the completion line go to the out sink.
  expect(out).toContain('Activating targets');
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

  progress.start({ totalTargets: 1 });
  progress.completeTarget({
    targetName: 'git',
    blockers: [],
    reports: [
      {
        verb: 'link',
        source: 'git/.gitconfig',
        dest: '~/.gitconfig',
        status: 'changed',
      },
    ],
  });
  progress.finish();

  // No animated output on the stream when not a TTY.
  expect(stream.output()).toBe('');
  expect(out).toContain('git: changed');
});

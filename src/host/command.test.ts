import { expect, test } from 'bun:test';
import { type CommandResult, formatCommandFailure } from './command';

function result(input: Partial<CommandResult>): CommandResult {
  return {
    code: input.code ?? 1,
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
  };
}

test('formatCommandFailure prefers stderr and trims command output', () => {
  expect(
    formatCommandFailure(
      'git pull failed',
      result({ stdout: ' stdout detail ', stderr: ' stderr detail\n' }),
    ),
  ).toBe('git pull failed with code 1: stderr detail');
});

test('formatCommandFailure falls back to stdout before the caller fallback', () => {
  expect(
    formatCommandFailure('git pull failed', result({ stdout: ' out\n' })),
  ).toBe('git pull failed with code 1: out');
  expect(
    formatCommandFailure(
      'git pull failed',
      result({}),
      'see command output above',
    ),
  ).toBe('git pull failed with code 1: see command output above');
});

test('formatCommandFailure includes the exit code and best available detail', () => {
  expect(
    formatCommandFailure(
      'git pull failed',
      result({ code: 2, stdout: 'out', stderr: '' }),
      'see command output above',
    ),
  ).toBe('git pull failed with code 2: out');
});

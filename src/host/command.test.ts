import { expect, test } from 'bun:test';
import {
  type CommandResult,
  commandFailureDetail,
  formatCommandFailure,
} from './command';

function result(input: Partial<CommandResult>): CommandResult {
  return {
    code: input.code ?? 1,
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
  };
}

test('commandFailureDetail prefers stderr and trims command output', () => {
  expect(
    commandFailureDetail(
      result({ stdout: ' stdout detail ', stderr: ' stderr detail\n' }),
    ),
  ).toBe('stderr detail');
});

test('commandFailureDetail falls back to stdout before the caller fallback', () => {
  expect(commandFailureDetail(result({ stdout: ' stdout detail\n' }))).toBe(
    'stdout detail',
  );
  expect(commandFailureDetail(result({}), 'see command output above')).toBe(
    'see command output above',
  );
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

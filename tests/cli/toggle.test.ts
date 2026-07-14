import { expect, mock, test } from 'bun:test';

// The only interactive branch worth asserting: an Escape / Ctrl+C surfaces from
// @inquirer/checkbox as an ExitPromptError, which toggle maps to null (cancel)
// rather than letting it abort the command.
test('toggle maps an ExitPromptError cancellation to null', async () => {
  mock.module('@inquirer/checkbox', () => ({
    default: async () => {
      const error = new Error('User force closed the prompt');
      error.name = 'ExitPromptError';
      throw error;
    },
  }));

  const { toggle } = await import('../../src/cli/tty/toggle');

  expect(await toggle('Pick', ['a', 'b'], ['a'])).toBeNull();
});

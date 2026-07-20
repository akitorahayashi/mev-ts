import { expect, test } from 'bun:test';
import { createToggle } from '../../src/cli/tty/toggle';

// The only interactive branch worth asserting: an Escape / Ctrl+C surfaces from
// the prompt as an ExitPromptError, which toggle maps to null (cancel) rather
// than letting it abort the command. Injecting the prompt avoids a process-wide
// module mock that would leak into sibling test files.
test('toggle maps an ExitPromptError cancellation to null', async () => {
  const toggle = createToggle(async () => {
    const error = new Error('User force closed the prompt');
    error.name = 'ExitPromptError';
    throw error;
  });

  expect(await toggle('Pick', ['a', 'b'], ['a'])).toBeNull();
});

test('toggle rethrows a non-cancellation prompt error', async () => {
  const toggle = createToggle(async () => {
    throw new Error('prompt exploded');
  });

  await expect(toggle('Pick', ['a', 'b'], ['a'])).rejects.toThrow(
    'prompt exploded',
  );
});

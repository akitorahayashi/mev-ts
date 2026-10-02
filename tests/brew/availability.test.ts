import { expect, test } from 'bun:test';
import { assertBrewAvailable } from '../../src/brew/availability';
import { ProvisioningError } from '../../src/errors';
import { recordingContext } from '../fixtures/fake-context';

test('available Homebrew passes the prerequisite check', async () => {
  const { context, calls } = recordingContext({ home: '/sandbox' });

  await expect(assertBrewAvailable(context)).resolves.toBeUndefined();
  expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
    ['brew', '--version'],
  ]);
});

test('unavailable Homebrew reports installation and shell-environment recovery', async () => {
  const { context } = recordingContext({
    home: '/sandbox',
    respond: () => ({ code: 127, stdout: '', stderr: 'brew unavailable' }),
  });

  const error = await assertBrewAvailable(context).catch(
    (error: unknown) => error,
  );

  expect(error).toBeInstanceOf(ProvisioningError);
  expect(String(error)).toContain('PATH');
  expect(String(error)).toContain('https://brew.sh');
  expect(String(error)).toContain('shellenv');
  expect(String(error)).toContain('brew --version');
});

test('a failed Homebrew check preserves its exit code and diagnostics', async () => {
  const { context } = recordingContext({
    home: '/sandbox',
    respond: () => ({
      code: 2,
      stdout: '',
      stderr: 'Homebrew installation is corrupt',
    }),
  });

  const error = await assertBrewAvailable(context).catch(
    (error: unknown) => error,
  );

  expect(error).toBeInstanceOf(ProvisioningError);
  expect(String(error)).toContain('code 2');
  expect(String(error)).toContain('Homebrew installation is corrupt');
});

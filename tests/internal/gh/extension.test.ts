import { expect, test } from 'bun:test';
import { ProvisioningError } from '../../../src/mev/errors';
import {
  extensionInstall,
  extensionInstalled,
} from '../../../src/mev/internal/gh/extension';
import type {
  CommandResult,
  CommandRunner,
} from '../../../src/mev/resources/model';

function runner(
  preset: CommandResult,
  sink: { args?: string[] } = {},
): CommandRunner {
  return {
    async run(_command, args): Promise<CommandResult> {
      sink.args = [...args];
      return preset;
    },
  };
}

test('extensionInstalled returns true when name appears in list output', async () => {
  const run = runner({
    code: 0,
    stdout: 'github/gh-copilot  v1.0.0\ncli/gh-screensaver  v0.0.1\n',
    stderr: '',
  });
  expect(await extensionInstalled(run, 'github/gh-copilot')).toBe(true);
});

test('extensionInstalled returns false when name is absent or only a substring match', async () => {
  const run = runner({
    code: 0,
    stdout: 'github/gh-copilot-chat  v1.0.0\ncli/gh-screensaver  v0.0.1\n',
    stderr: '',
  });
  expect(await extensionInstalled(run, 'github/gh-copilot')).toBe(false);
});

test('extensionInstalled returns false on non-zero exit', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'error' });
  expect(await extensionInstalled(run, 'github/gh-copilot')).toBe(false);
});

test('extensionInstalled passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await extensionInstalled(run, 'github/gh-copilot');
  expect(sink.args).toEqual(['extension', 'list']);
});

test('extensionInstall passes correct argv', async () => {
  const sink: { args?: string[] } = {};
  const run = runner({ code: 0, stdout: '', stderr: '' }, sink);
  await extensionInstall(run, 'github/gh-copilot');
  expect(sink.args).toEqual(['extension', 'install', 'github/gh-copilot']);
});

test('extensionInstall throws ProvisioningError on failure', async () => {
  const run = runner({ code: 1, stdout: '', stderr: 'error' });
  await expect(
    extensionInstall(run, 'github/gh-copilot'),
  ).rejects.toBeInstanceOf(ProvisioningError);
});

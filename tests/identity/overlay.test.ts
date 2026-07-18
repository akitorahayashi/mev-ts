import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningError } from '../../src/errors';
import {
  identityOverlayPath,
  preserveIdentityOverlay,
} from '../../src/identity/overlay';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('identity-overlay-');

async function managedConfig(home: string): Promise<string> {
  const path = join(home, '.config/git/config');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '[user]\n\tname = Legacy\n');
  return path;
}

sandboxTest('does nothing when the managed config is absent', async (home) => {
  const { context, calls } = recordingContext({ home });

  await preserveIdentityOverlay(
    { home, run: context.commands },
    join(home, '.config/git/config'),
  );

  expect(calls).toEqual([]);
});

sandboxTest(
  'copies the effective identity into an absent overlay',
  async (home) => {
    const managed = await managedConfig(home);
    const values: Record<string, string> = {
      'user.name': 'Legacy Name',
      'user.email': 'legacy@example.com',
    };
    const { context, calls } = recordingContext({
      home,
      respond(_command, args) {
        if (args[1] === '--global' && args[2] === '--get') {
          return {
            code: 0,
            stdout: `${values[args[3] ?? '']}\n`,
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    await preserveIdentityOverlay({ home, run: context.commands }, managed);

    const overlay = identityOverlayPath(home);
    expect(calls.map(({ args }) => args)).toEqual([
      ['config', '--global', '--get', 'user.name'],
      ['config', '--global', '--get', 'user.email'],
      ['config', '--file', overlay, 'user.name', 'Legacy Name'],
      ['config', '--file', overlay, 'user.email', 'legacy@example.com'],
    ]);
  },
);

sandboxTest(
  'keeps existing overlay values and copies only missing keys',
  async (home) => {
    const managed = await managedConfig(home);
    const overlay = identityOverlayPath(home);
    await writeFile(overlay, '[user]\n\tname = Current Name\n');
    const { context, calls } = recordingContext({
      home,
      respond(_command, args) {
        if (args[1] === '--file' && args[4] === 'user.name') {
          return { code: 0, stdout: 'Current Name\n', stderr: '' };
        }
        if (args[1] === '--file' && args[4] === 'user.email') {
          return { code: 1, stdout: '', stderr: '' };
        }
        if (args[1] === '--global' && args[3] === 'user.email') {
          return { code: 0, stdout: 'legacy@example.com\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    await preserveIdentityOverlay({ home, run: context.commands }, managed);

    expect(calls.map(({ args }) => args)).toEqual([
      ['config', '--file', overlay, '--get', 'user.name'],
      ['config', '--file', overlay, '--get', 'user.email'],
      ['config', '--global', '--get', 'user.email'],
      ['config', '--file', overlay, 'user.email', 'legacy@example.com'],
    ]);
  },
);

sandboxTest(
  'surfaces a read failure before attempting any overlay write',
  async (home) => {
    const managed = await managedConfig(home);
    const { context, calls } = recordingContext({
      home,
      respond() {
        return { code: 127, stdout: '', stderr: 'git not found' };
      },
    });

    await expect(
      preserveIdentityOverlay({ home, run: context.commands }, managed),
    ).rejects.toBeInstanceOf(ProvisioningError);
    expect(calls.map(({ args }) => args)).toEqual([
      ['config', '--global', '--get', 'user.name'],
    ]);
  },
);

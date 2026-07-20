import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../src/errors';
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
    expect(calls.slice(0, 2).map(({ args }) => args)).toEqual([
      ['config', '--global', '--get', 'user.name'],
      ['config', '--global', '--get', 'user.email'],
    ]);
    const writes = calls.slice(2).map(({ args }) => args);
    const firstWrite = writes[0];
    const secondWrite = writes[1];
    if (!firstWrite || !secondWrite) {
      throw new Error('expected two staged git config writes');
    }
    const stage = firstWrite[2];
    if (!stage) throw new Error('expected staged git config path');
    expect(writes[0]?.slice(0, 3)).toEqual(['config', '--file', stage]);
    expect(secondWrite[2]).toBe(stage);
    expect(writes.map((args) => args.slice(3))).toEqual([
      ['user.name', 'Legacy Name'],
      ['user.email', 'legacy@example.com'],
    ]);
    expect(stage).not.toBe(overlay);
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

    expect(calls.slice(0, 3).map(({ args }) => args)).toEqual([
      ['config', '--file', overlay, '--get', 'user.name'],
      ['config', '--file', overlay, '--get', 'user.email'],
      ['config', '--global', '--get', 'user.email'],
    ]);
    const write = calls[3]?.args;
    if (!write) throw new Error('expected staged git config write');
    const stage = write[2];
    if (!stage) throw new Error('expected staged git config path');
    expect(write.slice(0, 3)).toEqual(['config', '--file', stage]);
    expect(write?.slice(3)).toEqual(['user.email', 'legacy@example.com']);
    expect(stage).not.toBe(overlay);
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
    ).rejects.toBeInstanceOf(AppError);
    expect(calls.map(({ args }) => args)).toEqual([
      ['config', '--global', '--get', 'user.name'],
    ]);
  },
);

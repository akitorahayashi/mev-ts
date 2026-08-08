import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  readSshHost,
  sshHostPath,
  writeSshHost,
} from '../../src/github/ssh-host';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('github-ssh-host-');

sandboxTest(
  'uses github.com when no per-machine store exists',
  async (home) => {
    await expect(readSshHost(home)).resolves.toBe('github.com');
  },
);

sandboxTest('writes and reads a per-machine SSH host alias', async (home) => {
  const path = await writeSshHost(home, ' github-personal ');

  expect(path).toBe(sshHostPath(home));
  await expect(readSshHost(home)).resolves.toBe('github-personal');
});

sandboxTest(
  'rejects a malformed store instead of using the default',
  async (home) => {
    const path = sshHostPath(home);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'git@github.com\n');

    await expect(readSshHost(home)).rejects.toThrow(/SSH host/);
  },
);

sandboxTest(
  'tolerates trailing whitespace in the stored alias',
  async (home) => {
    const path = sshHostPath(home);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'github-personal\n\n');

    await expect(readSshHost(home)).resolves.toBe('github-personal');
  },
);

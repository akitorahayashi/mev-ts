import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { sshHostPath } from '../../src/github/ssh-host';
import { runCommandLine } from '../../src/main';
import { captureStreams } from '../fixtures/streams';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('ssh-host-command-');

sandboxTest('config ssh-host stores the positional SSH host', async (home) => {
  const previousHome = process.env['HOME'];
  process.env['HOME'] = home;
  try {
    const streams = captureStreams();
    const code = await runCommandLine(['config', 'ssh-host', 'github-work'], {
      stdout: streams.stdout as NodeJS.WriteStream,
      stderr: streams.stderr as NodeJS.WriteStream,
    });

    expect(code).toBe(0);
    expect(streams.stderrText()).toBe('');
    expect(streams.stdoutText()).toContain(sshHostPath(home));
    expect(await readFile(sshHostPath(home), 'utf8')).toBe('github-work\n');
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
  }
});

sandboxTest('config ssh-host rejects unsafe aliases', async (home) => {
  const previousHome = process.env['HOME'];
  process.env['HOME'] = home;
  try {
    const streams = captureStreams();
    const code = await runCommandLine(['cf', 'sh', 'git@github.com'], {
      stdout: streams.stdout as NodeJS.WriteStream,
      stderr: streams.stderr as NodeJS.WriteStream,
    });

    expect(code).toBe(1);
    expect(streams.stderrText()).toContain('SSH host');
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
  }
});

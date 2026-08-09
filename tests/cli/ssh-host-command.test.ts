import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { embeddedAssets } from '../../src/assets/registry';
import { sshHostPath } from '../../src/github/ssh-host';
import { runCommandLine } from '../../src/main';
import { appliedPath, writeApplied } from '../../src/provisioning/applied';
import { deployRole } from '../../src/provisioning/deploy';
import { isScanError, scanTargets } from '../../src/provisioning/scan';
import { targetSignature } from '../../src/provisioning/signature';
import { groveTarget } from '../../src/provisioning/targets/grove';
import { recordingContext } from '../fixtures/fake-context';
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
  const marker = appliedPath(home, groveTarget.name);
  const signature = `sha256:${'0'.repeat(64)}`;
  await writeApplied(marker, signature);
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
    expect(await readFile(marker, 'utf8')).toBe(`${signature}\n`);
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
  }
});

sandboxTest(
  'changing the SSH host makes an applied Grove target stale',
  async (home) => {
    const context = recordingContext({
      home,
      assets: embeddedAssets,
    }).context;
    await deployRole(groveTarget.role, context);
    await writeApplied(
      appliedPath(home, groveTarget.name),
      await targetSignature(groveTarget, embeddedAssets),
    );
    const [before] = await scanTargets([groveTarget], context);
    expect(before && !isScanError(before) ? before.reasons : null).toEqual([]);

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
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
    }

    const [after] = await scanTargets([groveTarget], context);
    expect(after && !isScanError(after) ? after.reasons : null).toEqual([
      'unapplied',
    ]);
  },
);

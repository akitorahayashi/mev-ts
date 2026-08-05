import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { pluginSourcePath } from '../../src/agent-plugin/source';
import { runCommandLine } from '../../src/main';
import { captureStreams } from '../fixtures/streams';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('plugin-host-command-');

sandboxTest(
  'config plugin-host stores the positional SSH host',
  async (home) => {
    const previousHome = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      const streams = captureStreams();
      const code = await runCommandLine(
        ['config', 'plugin-host', 'github-work'],
        {
          stdout: streams.stdout as NodeJS.WriteStream,
          stderr: streams.stderr as NodeJS.WriteStream,
        },
      );

      expect(code).toBe(0);
      expect(streams.stderrText()).toBe('');
      expect(streams.stdoutText()).toContain(pluginSourcePath(home));
      expect(await readFile(pluginSourcePath(home), 'utf8')).toBe(
        'ssh_host: github-work\n',
      );
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
    }
  },
);

sandboxTest('config plugin-host rejects unsafe aliases', async (home) => {
  const previousHome = process.env['HOME'];
  process.env['HOME'] = home;
  try {
    const streams = captureStreams();
    const code = await runCommandLine(['cf', 'ph', 'git@github.com'], {
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

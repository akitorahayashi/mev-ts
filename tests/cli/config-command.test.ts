import { expect, test } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BaseContext, Cli } from 'clipanion';
import { defineConfigCommand } from '../../src/cli/commands/config/namespace';
import { runReportingDomainErrors } from '../../src/cli/commands/domain-error';
import { runCliInSandbox } from '../fixtures/sandboxed-cli';
import { captureStreams } from '../fixtures/streams';
import { sandboxedTest } from '../fixtures/temporary-directory';

// The config toggle's diagnostics (skew warnings) belong on stderr, matching
// the internal-command wiring, so scriptable stdout stays clean. A spec whose
// runSelect only warns lets the stream binding be observed without driving the
// interactive prompt.
test('the config toggle routes its warn writer to stderr, not stdout', async () => {
  const ConfigCommand = defineConfigCommand({
    name: 'warn-probe',
    abbreviation: 'wp',
    description: 'probe',
    clearDescription: 'clear probe',
    runSelect: async (_home, warn) => {
      warn('warning: stale entry\n');
    },
    runClear: async () => {},
  });
  const cli = Cli.from([ConfigCommand]);

  const streams = captureStreams();

  const code = await cli.run(
    ['config', 'warn-probe'],
    streams as unknown as Partial<BaseContext>,
  );

  expect(code).toBe(0);
  expect(streams.stderrText()).toContain('warning: stale entry');
  expect(streams.stdoutText()).toBe('');
});

const sandboxTest = sandboxedTest('config-diagnostics-');
for (const surface of ['agents', 'skills', 'zed']) {
  sandboxTest(
    `${surface} non-directory resources produce domain diagnostics on stderr`,
    async (directory) => {
      const role = surface === 'zed' ? 'zed' : 'coder';
      const path = join(directory, '.mev/roles', role);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'not a directory');
      const result = await runCliInSandbox(
        ['config', surface, '--clear'],
        directory,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('ProvisioningError:');
      expect(result.stderr).toContain(path);
      expect(result.stderr).toContain('ENOTDIR');
      expect(result.stdout).toBe('');
    },
  );
}

test('unknown programming exceptions are not converted into domain diagnostics', async () => {
  const streams = captureStreams();
  const error = new TypeError('programmer failure');
  await expect(
    runReportingDomainErrors(
      streams.stderr as NodeJS.WritableStream,
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(streams.stderrText()).toBe('');
});

sandboxTest(
  'unreadable skill resources produce a labeled failure on stderr',
  async (directory) => {
    const path = join(directory, '.mev/roles/coder/skills');
    await mkdir(path, { recursive: true });
    await chmod(path, 0);
    try {
      const result = await runCliInSandbox(
        ['config', 'skills', '--clear'],
        directory,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'ProvisioningError: Failed to read Skills source directory',
      );
      expect(result.stderr).toContain(path);
      expect(result.stdout).toBe('');
    } finally {
      await chmod(path, 0o700);
    }
  },
);

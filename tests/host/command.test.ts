import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bunCommandRunner } from '../../src/host/command';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

// A real subprocess verifies the runner's inherited environment and PATH contract.
test('bunCommandRunner resolves commands using the current inherited PATH', async () => {
  await withTemporaryDirectory(async (dir) => {
    const command = 'mev-command-path-probe';
    await writeFile(
      join(dir, command),
      '#!/bin/sh\nprintf "sandbox command\\n"\n',
      {
        mode: 0o755,
      },
    );
    const previousPath = process.env['PATH'];
    process.env['PATH'] = dir;
    try {
      const result = await bunCommandRunner.run(command, []);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('sandbox command\n');
      expect(result.stderr).toBe('');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });
});

test('bunCommandRunner reports an unspawnable executable as code 127', async () => {
  await withTemporaryDirectory(async (dir) => {
    const missing = join(dir, 'definitely-not-a-real-binary');

    const result = await bunCommandRunner.run(missing, ['--version']);

    expect(result.code).toBe(127);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

test('bunCommandRunner still resolves the real result for a spawnable command', async () => {
  const result = await bunCommandRunner.run('true', []);

  expect(result.code).toBe(0);
});

// Real process groups verify timeout teardown, including descendants holding pipes.
for (const parent of ['wait', 'exit 0']) {
  test(`bunCommandRunner times out descendants when their parent uses ${parent}`, async () => {
    const result = await bunCommandRunner.run(
      '/bin/sh',
      [
        '-c',
        `printf 'started\\n'; printf 'waiting\\n' >&2; sleep 2 & ${parent}`,
      ],
      { timeoutMs: 100 },
    );

    expect(result.code).toBe(124);
    expect(result.stdout).toBe('started\n');
    expect(result.stderr).toContain('waiting');
    expect(result.stderr).toContain('timed out');
    expect(
      (await bunCommandRunner.run('true', [], { timeoutMs: 1000 })).code,
    ).toBe(0);
  });
}

test('bunCommandRunner rejects invalid deadlines before starting a command', async () => {
  for (const timeoutMs of [0, -1, Number.NaN, 0.5, 2_147_483_648]) {
    await expect(
      bunCommandRunner.run('true', [], { timeoutMs }),
    ).rejects.toThrow('Command timeout');
  }
});

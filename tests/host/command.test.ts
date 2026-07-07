import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { bunCommandRunner } from '../../src/host/command';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

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

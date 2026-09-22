import { expect, test } from 'bun:test';
import { runCommandLine } from '../../src/main';
import { captureStreams } from '../fixtures/streams';

async function captureCommandLine(args: readonly string[]) {
  const streams = captureStreams();
  const code = await runCommandLine(args, {
    colorDepth: 1,
    stdout: streams.stdout as NodeJS.WriteStream,
  });
  return { code, stdout: Bun.stripANSI(streams.stdoutText()) };
}

test('update exposes only the optional upgrade intent', async () => {
  const result = await captureCommandLine(['update', '--help']);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('$ mev update');
  expect(result.stdout).toContain('-u,--upgrade');
});

test('update rejects positional arguments', async () => {
  const result = await captureCommandLine(['update', 'extra']);

  expect(result.code).toBe(1);
  expect(result.stdout).toContain('$ mev update');
});

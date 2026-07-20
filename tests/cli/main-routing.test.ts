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

test('full-environment command help has no profile argument', async () => {
  const sync = await captureCommandLine(['s', '-h']);
  const create = await captureCommandLine(['cr', '-h']);

  expect(sync.code).toBe(0);
  expect(sync.stdout).toContain('$ mev sync');
  expect(sync.stdout).toContain('[aliases: s]');
  expect(create.code).toBe(0);
  expect(create.stdout).toContain('$ mev create');
});

test('full-environment commands reject stale profile arguments', async () => {
  const sync = await captureCommandLine(['sync', 'extra']);
  const create = await captureCommandLine(['create', 'extra']);

  expect(sync.code).toBe(1);
  expect(sync.stdout).toContain('$ mev sync');
  expect(create.code).toBe(1);
  expect(create.stdout).toContain('$ mev create');
});

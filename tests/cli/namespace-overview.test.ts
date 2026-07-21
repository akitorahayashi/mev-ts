import { expect, test } from 'bun:test';
import { runCommandLine } from '../../src/main';
import { captureStreams } from '../fixtures/streams';

/** Run a bare namespace command and return what its overview prints. */
async function namespaceOverview(namespace: string): Promise<string> {
  const streams = captureStreams();
  const code = await runCommandLine([namespace], {
    colorDepth: 1,
    stdout: streams.stdout as NodeJS.WriteStream,
    stderr: streams.stderr as NodeJS.WriteStream,
  });
  expect(code).toBe(0);
  expect(streams.stderrText()).toBe('');
  return streams.stdoutText();
}

// Wired through the real Cli: a subcommand registered under a mismatched usage
// category would drop out of its namespace's overview, which the shared category
// constants prevent. These assertions fail loudly if that wiring regresses.
test('the user namespace overview lists every user subcommand', async () => {
  const output = await namespaceOverview('user');
  expect(output).toContain('mev user <command>');
  expect(output).toContain('mev user show');
  expect(output).toContain('mev user set');
});

test('the config namespace overview lists every config subcommand', async () => {
  const output = await namespaceOverview('config');
  expect(output).toContain('mev config <command>');
  expect(output).toContain('mev config agents');
  expect(output).toContain('mev config skills');
  expect(output).toContain('mev config zed');
});

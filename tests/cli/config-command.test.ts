import { expect, test } from 'bun:test';
import { type BaseContext, Cli } from 'clipanion';
import { defineConfigCommand } from '../../src/cli/commands/config/command';
import { captureStreams } from '../fixtures/streams';

// The config toggle's diagnostics (skew warnings) belong on stderr, matching
// the internal-command wiring, so scriptable stdout stays clean. A spec whose
// runSelect only warns lets the stream binding be observed without driving the
// interactive prompt.
test('the config toggle routes its warn writer to stderr, not stdout', async () => {
  const ConfigCommand = defineConfigCommand({
    paths: [['config-warn-probe']],
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
    ['config-warn-probe'],
    streams as unknown as Partial<BaseContext>,
  );

  expect(code).toBe(0);
  expect(streams.stderrText()).toContain('warning: stale entry');
  expect(streams.stdoutText()).toBe('');
});

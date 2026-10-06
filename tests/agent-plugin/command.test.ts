import { expect } from 'bun:test';
import { noninteractiveRunner } from '../../src/agent-plugin/command';
import { ok } from '../fixtures/fake-command-runner';
import { recordingContext } from '../fixtures/fake-context';
import { sandboxedTest } from '../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('plugin-command-');

sandboxTest(
  'transport protection preserves caller environment, streams, and working directory',
  async (home) => {
    const { context, calls } = recordingContext({
      home,
      respond: () => ok('result'),
    });
    const result = await noninteractiveRunner(context.commands).run(
      'claude',
      ['plugin', 'list', '--json'],
      {
        cwd: home,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          PATH: '/test/bin',
          LC_ALL: 'C',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=no',
        },
      },
    );

    expect(result.stdout).toBe('result');
    expect(calls[0]?.options).toMatchObject({
      cwd: home,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        PATH: '/test/bin',
        LC_ALL: 'C',
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_VARIANT: 'ssh',
      },
    });
    expect(calls[0]?.options?.env?.['GIT_SSH_COMMAND']).toContain(
      'BatchMode=yes',
    );
    expect(calls[0]?.options?.timeoutMs).toBeGreaterThan(0);
  },
);

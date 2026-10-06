import { ProvisioningError } from '../errors';
import type { CommandRunner } from '../host/command';

export class MarketplaceFetchError extends ProvisioningError {}

const COMMAND_TIMEOUT_MS = 120_000;
const SSH_COMMAND =
  'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=1';

export function noninteractiveRunner(run: CommandRunner): CommandRunner {
  return {
    run(command, args, options) {
      return run.run(command, args, {
        ...options,
        timeoutMs: COMMAND_TIMEOUT_MS,
        env: {
          ...options?.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: SSH_COMMAND,
          GIT_SSH_VARIANT: 'ssh',
          SSH_ASKPASS_REQUIRE: 'never',
        },
      });
    },
  };
}

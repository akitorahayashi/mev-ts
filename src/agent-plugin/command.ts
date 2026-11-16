import { ProvisioningError } from '../errors';
import type { CommandRunner } from '../host/command';
import type { Context } from '../host/context';
import { mevPath, resolveHostPath } from '../host/path';

export class MarketplaceFetchError extends ProvisioningError {}

const COMMAND_TIMEOUT_MS = 120_000;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Every marketplace fetch is its own git process, and a fresh SSH connection
 * costs about nine round trips before git sends anything. One shared
 * connection per alias lets later fetches, from either client, skip that
 * handshake; the master closes itself once idle, so nothing has to tear it
 * down.
 *
 * The socket is keyed on `%n`, the alias as written, rather than `%C`: two
 * aliases for github.com resolve to the same host and port but select
 * different accounts, and `%C` would hand one the other's authenticated
 * connection. `-S` carries the path because `-o ControlPath=` re-tokenizes its
 * value, which splits a home directory containing a space.
 */
function sshCommand(home: string): string {
  const mevRoot = resolveHostPath(mevPath(), home).replaceAll('%', '%%');
  return [
    'ssh',
    '-o BatchMode=yes',
    '-o StrictHostKeyChecking=yes',
    '-o ConnectTimeout=30',
    '-o ServerAliveInterval=30',
    '-o ServerAliveCountMax=1',
    '-o ControlMaster=auto',
    '-o ControlPersist=30',
    `-S ${shellQuote(`${mevRoot}/ssh-control-%n`)}`,
  ].join(' ');
}

export function noninteractiveRunner(
  context: Pick<Context, 'commands' | 'home'>,
): CommandRunner {
  const gitSshCommand = sshCommand(context.home);
  return {
    run(command, args, options) {
      return context.commands.run(command, args, {
        ...options,
        timeoutMs: COMMAND_TIMEOUT_MS,
        env: {
          ...options?.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: gitSshCommand,
          GIT_SSH_VARIANT: 'ssh',
          SSH_ASKPASS_REQUIRE: 'never',
        },
      });
    },
  };
}

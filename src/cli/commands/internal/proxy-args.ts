import type { Command } from 'clipanion';
import type { CommandRunner } from '../../../host/command';
import { runInternalCommand } from './command';

/**
 * Shared execute body for the internal git commands that forward proxied argv to
 * a domain operation (`clone`, `delete-branches`). The two commands differ only
 * in the domain function, so the runInternalCommand wiring lives here once.
 */
export function runProxiedArgs(
  command: Command,
  args: readonly string[],
  domain: (
    run: CommandRunner,
    args: readonly string[],
    write: (message: string) => void,
  ) => Promise<void>,
  // biome-ignore lint/suspicious/noConfusingVoidType: mirrors runInternalCommand's optional exit code.
): Promise<number | void> {
  return runInternalCommand(command, (run, write) => domain(run, args, write));
}

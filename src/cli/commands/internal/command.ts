import type { Command } from 'clipanion';
import { bunCommandRunner, type CommandRunner } from '../../../host/command';
import { runReportingDomainErrors } from '../domain-error';

/**
 * Run an internal command's domain operation with the wiring every internal
 * command shares: the live command runner, a stdout progress writer, and the
 * stderr domain-error reporter (exit code 1 on `AppError`). Each command still
 * declares its own paths and options; only this cross-cutting wiring lives here,
 * so every internal command reports progress the same way.
 */
export function runInternalCommand(
  command: Command,
  domain: (
    run: CommandRunner,
    write: (message: string) => void,
  ) => Promise<void>,
  // biome-ignore lint/suspicious/noConfusingVoidType: mirrors the command boundary's optional exit code.
): Promise<number | void> {
  return runReportingDomainErrors(command.context.stderr, () =>
    domain(bunCommandRunner, (message) => {
      command.context.stdout.write(message);
    }),
  );
}

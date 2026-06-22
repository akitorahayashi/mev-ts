import { type CAC, cac } from 'cac';
import packageMetadata from '../../../package.json';
import { CommandLineError } from '../errors';
import { registerInternalGhCommands } from './commands/internal-gh';

function createInternalProgram(): CAC {
  const program = cac(`${packageMetadata.name} internal`);
  program.usage('<command> [options]');
  registerInternalGhCommands(program);
  program.help();
  return program;
}

export async function runInternalCommandLine(
  args: readonly string[],
): Promise<number> {
  const program = createInternalProgram();

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    program.outputHelp();
    return 0;
  }

  try {
    program.parse(['bun', `${packageMetadata.name} internal`, ...args], {
      run: false,
    });

    if (!program.matchedCommand) {
      throw new CommandLineError(
        `Unknown internal command '${program.args[0]}'.`,
      );
    }

    const command = program.matchedCommand;
    if (
      !command.args.some((arg) => arg.variadic) &&
      program.args.length > command.args.length
    ) {
      throw new CommandLineError(
        `Unexpected positional arguments: ${program.args.slice(command.args.length).join(', ')}.`,
      );
    }

    const outcome: unknown = await program.runMatchedCommand();
    return isFailingOutcome(outcome) ? 1 : 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);

    if (isUsageError(error)) {
      program.outputHelp();
    }

    return 1;
  }
}

function isFailingOutcome(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'failed' in value &&
    (value as { failed: unknown }).failed === true
  );
}

function isUsageError(error: unknown): boolean {
  return (
    error instanceof CommandLineError ||
    (error instanceof Error && error.name === 'CACError')
  );
}

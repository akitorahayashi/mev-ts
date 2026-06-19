import { type CAC, cac } from 'cac';
import packageMetadata from '../../../package.json';
import { CommandLineError } from '../errors';
import { registerGreetCommand } from './greet';

export async function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  const program = createProgram();

  if (args.length === 0) {
    program.outputHelp();
    return 0;
  }

  if (isVersionRequest(args)) {
    writeOutput(`${packageMetadata.name} ${packageMetadata.version}`);
    return 0;
  }

  try {
    rejectUnsupportedTopLevelOptions(args);

    program.parse(['bun', packageMetadata.name, ...args], { run: false });

    if (program.options.help) {
      return 0;
    }

    if (!program.matchedCommand) {
      throw new CommandLineError(`Unknown command '${program.args[0]}'.`);
    }

    rejectUnexpectedPositionals(program);
    await program.runMatchedCommand();

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(message);

    if (isUsageError(error)) {
      program.outputHelp();
    }

    return 1;
  }
}

function createProgram(): CAC {
  const program = cac(packageMetadata.name);

  program.usage('<command> [options]');
  registerGreetCommand(program);
  program.help();

  return program;
}

function isVersionRequest(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === '--version' || args[0] === '-v');
}

function rejectUnsupportedTopLevelOptions(args: readonly string[]): void {
  const firstArg = args[0];

  if (!firstArg?.startsWith('-') || isHelpRequest(firstArg)) {
    return;
  }

  throw new CommandLineError(`Unknown option '${firstArg}'.`);
}

function isHelpRequest(arg: string): boolean {
  return arg === '--help' || arg === '-h';
}

function rejectUnexpectedPositionals(program: CAC): void {
  const command = program.matchedCommand;

  if (!command || command.args.some((arg) => arg.variadic)) {
    return;
  }

  if (program.args.length <= command.args.length) {
    return;
  }

  throw new CommandLineError(
    `Unexpected positional arguments: ${program.args.slice(command.args.length).join(', ')}.`,
  );
}

function isUsageError(error: unknown): boolean {
  return (
    error instanceof CommandLineError ||
    (error instanceof Error && error.name === 'CACError')
  );
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function writeOutput(message: string): void {
  process.stdout.write(`${message}\n`);
}

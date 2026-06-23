import { type CAC, type Command, cac } from 'cac';
import packageMetadata from '../../../package.json';
import { CommandLineError } from '../errors';
import { registerListCommand } from './commands/list';
import { registerMakeCommand } from './commands/make';
import { registerUserCommand } from './commands/user';
import { runInternalCommandLine } from './internal';
import {
  type CommandHelp,
  type RootHelp,
  renderCommandHelp,
  renderRootHelp,
} from './tty/help';

export interface CommandOutcome {
  readonly failed: boolean;
}

export async function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  const program = createProgram();

  if (args.length === 0 || isHelpRequest(args[0])) {
    writeOutput(renderRootHelp(rootHelp(program)));
    return 0;
  }

  if (isVersionRequest(args)) {
    writeOutput(`${packageMetadata.name} ${packageMetadata.version}`);
    return 0;
  }

  if (args[0] === 'internal') {
    return runInternalCommandLine(args.slice(1));
  }

  try {
    rejectUnsupportedTopLevelOptions(args);

    program.parse(['bun', packageMetadata.name, ...args], { run: false });

    if (!program.matchedCommand) {
      throw new CommandLineError(`Unknown command '${args[0]}'.`);
    }

    if (containsHelpFlag(args)) {
      writeOutput(
        renderCommandHelp(
          packageMetadata.name,
          commandHelp(program.matchedCommand),
        ),
      );
      return 0;
    }

    rejectUnexpectedPositionals(program);
    const outcome: unknown = await program.runMatchedCommand();

    return isFailingOutcome(outcome) ? 1 : 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(message);

    if (isUsageError(error)) {
      writeOutput(renderRootHelp(rootHelp(program)));
    }

    return 1;
  }
}

function createProgram(): CAC {
  const program = cac(packageMetadata.name);

  registerMakeCommand(program);
  registerListCommand(program);
  registerUserCommand(program);

  return program;
}

function rootHelp(program: CAC): RootHelp {
  return {
    bin: packageMetadata.name,
    tagline: packageMetadata.description,
    commands: program.commands.map(commandHelp),
  };
}

function commandHelp(command: Command): CommandHelp {
  return {
    invocation: command.rawName,
    aliases: command.aliasNames.filter((alias) => alias !== command.name),
    description: command.description,
    options: command.options.map((option) => ({
      flags: option.rawName,
      description: option.description,
    })),
  };
}

function isFailingOutcome(value: unknown): value is CommandOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    'failed' in value &&
    (value as CommandOutcome).failed === true
  );
}

function isVersionRequest(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === '--version' || args[0] === '-v');
}

function rejectUnsupportedTopLevelOptions(args: readonly string[]): void {
  const firstArg = args[0];

  if (!firstArg?.startsWith('-')) {
    return;
  }

  throw new CommandLineError(`Unknown option '${firstArg}'.`);
}

function isHelpRequest(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h';
}

function containsHelpFlag(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
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

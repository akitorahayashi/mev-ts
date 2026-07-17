#!/usr/bin/env bun

import { type BaseContext, Builtins, Cli } from 'clipanion';
import packageMetadata from '../package.json';
import { commands } from './cli/commands/registry';

function createCli(): Cli {
  const cli = new Cli({
    binaryLabel: packageMetadata.description,
    binaryName: packageMetadata.name,
    binaryVersion: packageMetadata.version,
  });

  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);
  for (const command of commands) {
    cli.register(command);
  }

  return cli;
}

const HELP_FLAGS = new Set(['-h', '--help']);

/**
 * `--help` after a namespace token (e.g. `config --help`) resolves through
 * clipanion's ambiguous-match listing rather than that namespace's own bare
 * command, because clipanion matches `-h`/`--help` against every registered
 * path sharing the prefix. When the namespace has both a bare command (its own
 * overview) and subcommands, drop the trailing help flag so it resolves to the
 * overview instead of listing every subcommand redundantly. A leaf command like
 * `make --help` (a bare command with no subcommands) is left untouched so its
 * detailed help still shows.
 *
 * Decided from the registered command paths (token arrays, including aliases),
 * not clipanion internals, so a minor clipanion change cannot silently break it.
 */
export function rewriteNamespaceHelp(
  args: readonly string[],
  paths: readonly (readonly string[])[],
): readonly string[] {
  const [namespace, flag] = args;
  if (
    args.length !== 2 ||
    namespace === undefined ||
    flag === undefined ||
    !HELP_FLAGS.has(flag)
  ) {
    return args;
  }
  const hasBare = paths.some(
    (path) => path.length === 1 && path[0] === namespace,
  );
  const hasSubcommand = paths.some(
    (path) => path.length > 1 && path[0] === namespace,
  );
  return hasBare && hasSubcommand ? [namespace] : args;
}

export function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
  context?: Partial<BaseContext>,
): Promise<number> {
  const cli = createCli();
  const paths = commands.flatMap((command) => command.paths ?? []);
  const input = [...rewriteNamespaceHelp(args, paths)];
  // Forward an injected context (tests, embedders) to clipanion; with none, its
  // default context binds the real process streams — byte-identical to before.
  return context ? cli.run(input, context) : cli.run(input);
}

if (import.meta.main) {
  process.exitCode = await runCommandLine();
}

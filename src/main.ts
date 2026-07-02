#!/usr/bin/env bun

import { Builtins, Cli } from 'clipanion';
import packageMetadata from '../package.json';
import { ConfigHelpCommand } from './cli/commands/config/help';
import { ConfigSelectCommand } from './cli/commands/config/select';
import { CreateCommand } from './cli/commands/create';
import { InternalGhLabelsDeployCommand } from './cli/commands/internal/gh-labels-deploy';
import { InternalGhLabelsResetCommand } from './cli/commands/internal/gh-labels-reset';
import { InternalGitCloneCommand } from './cli/commands/internal/git-clone';
import { InternalGitDeleteBranchesCommand } from './cli/commands/internal/git-delete-branches';
import { InternalGitDeleteSubmoduleCommand } from './cli/commands/internal/git-delete-submodule';
import { ListCommand } from './cli/commands/list';
import { MakeCommand } from './cli/commands/make';
import { SwitchCommand } from './cli/commands/switch';
import { UserCommand } from './cli/commands/user';

function createCli(): Cli {
  const cli = new Cli({
    binaryLabel: packageMetadata.description,
    binaryName: packageMetadata.name,
    binaryVersion: packageMetadata.version,
  });

  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);
  cli.register(MakeCommand);
  cli.register(CreateCommand);
  cli.register(ConfigHelpCommand);
  cli.register(ConfigSelectCommand);
  cli.register(ListCommand);
  cli.register(SwitchCommand);
  cli.register(UserCommand);
  cli.register(InternalGitCloneCommand);
  cli.register(InternalGitDeleteBranchesCommand);
  cli.register(InternalGitDeleteSubmoduleCommand);
  cli.register(InternalGhLabelsDeployCommand);
  cli.register(InternalGhLabelsResetCommand);

  return cli;
}

const HELP_FLAGS = new Set(['-h', '--help']);

// `--help` after a namespace token (e.g. `config --help`) always resolves
// through clipanion's ambiguous-match listing rather than that namespace's
// own bare command, because clipanion matches `-h`/`--help` against every
// registered path sharing the prefix instead of the exact typed path. When
// the ambiguous set includes a command registered bare at that exact token
// (e.g. `ConfigHelpCommand`, whose own bare form already is that
// namespace's help), drop the trailing help flag so it resolves there
// instead of listing every subcommand redundantly.
function dropRedundantNamespaceHelpFlag(
  cli: Cli,
  args: readonly string[],
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
  const resolved = cli.process([...args]) as unknown as {
    commands?: readonly number[];
    contexts: readonly {
      commandClass: { paths?: readonly (readonly string[])[] };
    }[];
  };
  if (!resolved.commands || resolved.commands.length <= 1) {
    return args;
  }
  const hasBareMatch = resolved.commands.some((index) =>
    (resolved.contexts[index]?.commandClass.paths ?? []).some(
      (path) => path.length === 1 && path[0] === namespace,
    ),
  );
  return hasBareMatch ? [namespace] : args;
}

export function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  const cli = createCli();
  return cli.run([...dropRedundantNamespaceHelpFlag(cli, args)]);
}

if (import.meta.main) {
  process.exitCode = await runCommandLine();
}

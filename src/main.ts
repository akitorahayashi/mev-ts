#!/usr/bin/env bun

import { Builtins, Cli } from 'clipanion';
import packageMetadata from '../package.json';
import { ConfigSelectCommand } from './cli/commands/config';
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

export function runCommandLine(
  args: readonly string[] = Bun.argv.slice(2),
): Promise<number> {
  return createCli().run([...args]);
}

if (import.meta.main) {
  process.exitCode = await runCommandLine();
}

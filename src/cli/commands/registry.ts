import type { CommandClass } from 'clipanion';
import { ConfigAgentsCommand } from './config/agents';
import { ConfigHelpCommand } from './config/help';
import { ConfigSkillsCommand } from './config/skills';
import { ConfigZedCommand } from './config/zed';
import { CreateCommand } from './create';
import { InternalGhLabelsDeployCommand } from './internal/gh-labels-deploy';
import { InternalGhLabelsResetCommand } from './internal/gh-labels-reset';
import { InternalGitCloneCommand } from './internal/git-clone';
import { InternalGitDeleteBranchesCommand } from './internal/git-delete-branches';
import { InternalGitDeleteSubmoduleCommand } from './internal/git-delete-submodule';
import { ListCommand } from './list';
import { MakeCommand } from './make';
import { SwitchCommand } from './switch';
import { UserHelpCommand, UserSetCommand, UserShowCommand } from './user';

/**
 * The authoritative list of project commands. `main.ts` iterates this to
 * register them, and the namespace-help routing reads their paths — so adding a
 * command means adding it here, once. A completeness test fails if a command
 * class under `cli/commands/` is exported but missing from this list.
 */
export const commands: readonly CommandClass[] = [
  MakeCommand,
  CreateCommand,
  ConfigHelpCommand,
  ConfigAgentsCommand,
  ConfigSkillsCommand,
  ConfigZedCommand,
  ListCommand,
  SwitchCommand,
  UserHelpCommand,
  UserShowCommand,
  UserSetCommand,
  InternalGitCloneCommand,
  InternalGitDeleteBranchesCommand,
  InternalGitDeleteSubmoduleCommand,
  InternalGhLabelsDeployCommand,
  InternalGhLabelsResetCommand,
];

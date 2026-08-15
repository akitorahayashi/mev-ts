import { Command, Option } from 'clipanion';
import { tidyWorktrees } from '../../../internal/git/worktree/tidy';
import { runInternalCommand } from './run';

export class InternalGitWorktreeTidyCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'tidy']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      tidyWorktrees(run, this.args, write),
    );
  }
}

import { Command, Option } from 'clipanion';
import { removeWorktrees } from '../../../internal/git/worktree/remove';
import { runInternalCommand } from './run';

export class InternalGitWorktreeRemoveCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'remove']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      removeWorktrees(run, this.args, write),
    );
  }
}

import { Command, Option } from 'clipanion';
import { moveWorktree } from '../../../internal/git/worktree/move';
import { runInternalCommand } from './run';

export class InternalGitWorktreeMoveCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'move']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      moveWorktree(run, this.args, write),
    );
  }
}

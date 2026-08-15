import { Command, Option } from 'clipanion';
import { printWorktreePath } from '../../../internal/git/worktree/path';
import { runInternalCommand } from './run';

export class InternalGitWorktreePathCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'path']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      printWorktreePath(run, this.args, write),
    );
  }
}

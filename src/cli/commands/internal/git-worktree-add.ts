import { Command, Option } from 'clipanion';
import { addWorktrees } from '../../../internal/git/worktree/add';
import { runInternalCommand } from './run';

export class InternalGitWorktreeAddCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'add']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      addWorktrees(run, this.args, write),
    );
  }
}

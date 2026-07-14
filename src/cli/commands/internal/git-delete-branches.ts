import { Command, Option } from 'clipanion';
import { deleteBranches } from '../../../internal/git/branches';
import { runInternalCommand } from './command';

export class InternalGitDeleteBranchesCommand extends Command {
  static override paths = [['internal', 'git', 'delete-branches']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      deleteBranches(run, this.args, write),
    );
  }
}

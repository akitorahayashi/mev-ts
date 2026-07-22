import { Command, Option } from 'clipanion';
import { deleteBranches } from '../../../internal/git/branches';
import { runProxiedArgs } from './proxy-args';

export class InternalGitDeleteBranchesCommand extends Command {
  static override paths = [['internal', 'git', 'delete-branches']];

  args = Option.Proxy();

  async execute() {
    return runProxiedArgs(this, this.args, deleteBranches);
  }
}

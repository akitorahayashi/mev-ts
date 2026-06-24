import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { deleteBranches } from '../../../internal/git/branches';

export class InternalGitDeleteBranchesCommand extends Command {
  static override paths = [['internal', 'git', 'delete-branches']];

  args = Option.Proxy();

  async execute(): Promise<void> {
    await deleteBranches(bunCommandRunner, this.args);
  }
}

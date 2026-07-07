import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { deleteBranches } from '../../../internal/git/branches';
import { runReportingDomainErrors } from '../domain-error';

export class InternalGitDeleteBranchesCommand extends Command {
  static override paths = [['internal', 'git', 'delete-branches']];

  args = Option.Proxy();

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      deleteBranches(bunCommandRunner, this.args),
    );
  }
}

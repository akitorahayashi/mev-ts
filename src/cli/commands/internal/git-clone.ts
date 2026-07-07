import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { cloneRepositories } from '../../../internal/git/clone';
import { runReportingDomainErrors } from '../domain-error';

export class InternalGitCloneCommand extends Command {
  static override paths = [['internal', 'git', 'clone']];

  args = Option.Proxy();

  async execute() {
    return runReportingDomainErrors(this.context.stderr, () =>
      cloneRepositories(
        bunCommandRunner,
        this.args,
        process.stdout.write.bind(process.stdout),
      ),
    );
  }
}

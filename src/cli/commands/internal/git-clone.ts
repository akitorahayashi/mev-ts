import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { cloneRepositories } from '../../../internal/git/clone';

export class InternalGitCloneCommand extends Command {
  static override paths = [['internal', 'git', 'clone']];

  args = Option.Proxy();

  async execute(): Promise<void> {
    await cloneRepositories(bunCommandRunner, this.args);
  }
}

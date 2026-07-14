import { Command, Option } from 'clipanion';
import { cloneRepositories } from '../../../internal/git/clone';
import { runInternalCommand } from './command';

export class InternalGitCloneCommand extends Command {
  static override paths = [['internal', 'git', 'clone']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      cloneRepositories(run, this.args, write),
    );
  }
}

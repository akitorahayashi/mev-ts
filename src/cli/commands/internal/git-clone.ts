import { Command, Option } from 'clipanion';
import { cloneRepositories } from '../../../internal/git/clone';
import { runProxiedArgs } from './proxy-args';

export class InternalGitCloneCommand extends Command {
  static override paths = [['internal', 'git', 'clone']];

  args = Option.Proxy();

  async execute() {
    return runProxiedArgs(this, this.args, cloneRepositories);
  }
}

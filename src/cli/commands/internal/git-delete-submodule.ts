import { Command, Option } from 'clipanion';
import { deleteSubmodule } from '../../../internal/git/submodule';
import { runInternalCommand } from './command';

export class InternalGitDeleteSubmoduleCommand extends Command {
  static override paths = [['internal', 'git', 'delete-submodule']];

  submodulePath = Option.String({ required: true });

  async execute() {
    return runInternalCommand(this, (run, write) =>
      deleteSubmodule(run, [this.submodulePath], write),
    );
  }
}

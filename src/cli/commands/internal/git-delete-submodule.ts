import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { deleteSubmodule } from '../../../internal/git/submodule';

export class InternalGitDeleteSubmoduleCommand extends Command {
  static override paths = [['internal', 'git', 'delete-submodule']];

  submodulePath = Option.String({ required: true });

  async execute(): Promise<void> {
    await deleteSubmodule(
      bunCommandRunner,
      [this.submodulePath],
      process.stdout.write.bind(process.stdout),
    );
  }
}

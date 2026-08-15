import { Command, Option } from 'clipanion';
import { CommandLineError } from '../../../errors';
import { readInventory } from '../../../internal/git/worktree/inventory';
import { readStates } from '../../../internal/git/worktree/state';
import { resolveIsTTY } from '../../tty/style';
import { renderWorktreeList } from '../../tty/worktreelist';
import { runInternalCommand } from './run';

export class InternalGitWorktreeListCommand extends Command {
  static override paths = [['internal', 'git', 'worktree', 'list']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, async (run) => {
      const [unexpected] = this.args;
      if (unexpected !== undefined) {
        throw new CommandLineError(
          `Unexpected argument '${unexpected}': list takes no arguments.`,
        );
      }
      const inventory = await readInventory(run);
      const states = await readStates(run, inventory.entries);
      this.context.stdout.write(
        renderWorktreeList(resolveIsTTY(this.context.stdout), states),
      );
    });
  }
}

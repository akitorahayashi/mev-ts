import { Command, Option } from 'clipanion';
import { buildResetTasks } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';
import { runInternalCommand } from './command';

export class InternalGhLabelsResetCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'reset']];

  repo = Option.String('--repo,-R', { required: false });

  async execute() {
    return runInternalCommand(this, async (run) => {
      const tasks = await buildResetTasks(run, this.repo);
      await renderLiveList(
        tasks.map((task) => ({ label: task.name, run: () => task.apply() })),
        { concurrent: true },
      );
    });
  }
}

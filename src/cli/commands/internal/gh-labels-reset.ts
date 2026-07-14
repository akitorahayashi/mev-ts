import { Command, Option } from 'clipanion';
import { buildResetTasks } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';
import { runInternalCommand } from './command';

export class InternalGhLabelsResetCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'reset']];

  repo = Option.String('--repo,-R', { required: false });

  async execute() {
    return runInternalCommand(this, async (run) => {
      const items = await buildResetTasks(run, this.repo);
      await renderLiveList(items, { concurrent: true });
    });
  }
}

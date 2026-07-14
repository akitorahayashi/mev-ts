import { Command, Option } from 'clipanion';
import { buildDeployTasks } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';
import { runInternalCommand } from './command';

export class InternalGhLabelsDeployCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'deploy']];

  repo = Option.String('--repo,-R', { required: false });

  async execute() {
    return runInternalCommand(this, async (run) => {
      const items = await buildDeployTasks(run, this.repo);
      await renderLiveList(items, { concurrent: true });
    });
  }
}

import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { buildDeployTasks } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';

export class InternalGhLabelsDeployCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'deploy']];

  repo = Option.String('--repo,-R', { required: false });

  async execute(): Promise<void> {
    const items = await buildDeployTasks(bunCommandRunner, this.repo);
    await renderLiveList(items, { concurrent: true });
  }
}

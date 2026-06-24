import { Command, Option } from 'clipanion';
import { bunCommandRunner } from '../../../host/command';
import { buildResetTasks } from '../../../internal/gh/labels';
import { renderLiveList } from '../../tty/livelist';

export class InternalGhLabelsResetCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'reset']];

  repo = Option.String('--repo,-R', { required: false });

  async execute(): Promise<void> {
    const items = await buildResetTasks(bunCommandRunner, this.repo);
    await renderLiveList(items, { concurrent: true });
  }
}

import { Command, Option } from 'clipanion';
import { buildResetTasks } from '../../../internal/gh/labels';
import { runLabelTasks } from './label-tasks';

export class InternalGhLabelsResetCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'reset']];

  repo = Option.String('--repo,-R', { required: false });

  async execute() {
    return runLabelTasks(this, buildResetTasks, this.repo);
  }
}

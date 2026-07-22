import { Command, Option } from 'clipanion';
import { buildDeployTasks } from '../../../internal/gh/labels';
import { runLabelTasks } from './label-tasks';

export class InternalGhLabelsDeployCommand extends Command {
  static override paths = [['internal', 'gh', 'labels', 'deploy']];

  repo = Option.String('--repo,-R', { required: false });

  async execute() {
    return runLabelTasks(this, buildDeployTasks, this.repo);
  }
}

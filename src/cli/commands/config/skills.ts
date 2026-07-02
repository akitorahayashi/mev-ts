import { Command, Option } from 'clipanion';
import { configSelect, configSelectClear } from '../../../app/coder';
import { resolveHome } from '../../../host/context';

export class ConfigSkillsCommand extends Command {
  static override paths = [
    ['config', 'skills'],
    ['cf', 'sk'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description: 'Interactively select enabled skills. [aliases: cf sk]',
  });

  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute(): Promise<void> {
    const home = resolveHome();
    if (this.clear) {
      await configSelectClear('skills', home);
    } else {
      await configSelect('skills', home);
    }
  }
}

import { Command, Option } from 'clipanion';
import {
  configSelectZedOverrides,
  configSelectZedOverridesClear,
} from '../../../app/zed';
import { resolveHome } from '../../../host/context';

export class ConfigZedCommand extends Command {
  static override paths = [
    ['config', 'zed'],
    ['config', 'zd'],
    ['cf', 'zed'],
    ['cf', 'zd'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description:
      'Interactively select enabled Zed setting overrides. [aliases: zd, cf zd]',
  });

  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute(): Promise<void> {
    const home = resolveHome();
    if (this.clear) {
      await configSelectZedOverridesClear(home);
    } else {
      await configSelectZedOverrides(home);
    }
  }
}

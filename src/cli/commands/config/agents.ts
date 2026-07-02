import { Command, Option } from 'clipanion';
import { configSelect, configSelectClear } from '../../../app/coder';
import { resolveHome } from '../../../host/context';

export class ConfigAgentsCommand extends Command {
  static override paths = [
    ['config', 'agents'],
    ['cf', 'ag'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description:
      'Interactively select enabled AGENTS.md sections. [aliases: cf ag]',
  });

  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute(): Promise<void> {
    const home = resolveHome();
    if (this.clear) {
      await configSelectClear('agents', home);
    } else {
      await configSelect('agents', home);
    }
  }
}

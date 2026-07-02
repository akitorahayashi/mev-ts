import { Command, Option } from 'clipanion';
import {
  type CoderSelectable,
  configSelect,
  configSelectClear,
} from '../../../app/coder';
import { CommandLineError } from '../../../errors';
import { resolveHome } from '../../../host/context';

const SELECTABLES: Record<string, CoderSelectable> = {
  agents: 'agents',
  ag: 'agents',
  skills: 'skills',
  sk: 'skills',
};

export class ConfigSelectCommand extends Command {
  static override paths = [
    ['config', 'select'],
    ['cf', 'sl'],
  ];
  static override usage = Command.Usage({
    category: 'config',
    description:
      'Interactively select enabled AGENTS.md sections or skills. [aliases: cf sl]',
  });

  object = Option.String({ required: true });
  clear = Option.Boolean('--clear', false, {
    description: 'Disable all entries.',
  });

  async execute(): Promise<void> {
    const kind = SELECTABLES[this.object];
    if (!kind) {
      throw new CommandLineError(
        `Unknown selectable '${this.object}'. Use: agents (ag), skills (sk).`,
      );
    }
    const home = resolveHome();
    if (this.clear) {
      await configSelectClear(kind, home);
    } else {
      await configSelect(kind, home);
    }
  }
}

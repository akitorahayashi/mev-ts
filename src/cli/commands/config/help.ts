import { Command } from 'clipanion';
import { writeNamespaceOverview } from '../namespace-overview';

export class ConfigHelpCommand extends Command {
  static override paths = [['config'], ['cf']];
  static override usage = Command.Usage({
    category: 'config',
    description: 'Show config subcommands. [aliases: cf]',
  });

  async execute(): Promise<void> {
    const [canonical = []] = ConfigHelpCommand.paths;
    writeNamespaceOverview(this, 'config', canonical);
  }
}

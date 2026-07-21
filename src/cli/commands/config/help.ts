import { Command } from 'clipanion';
import { renderNamespaceOverview } from '../../tty/namespace-overview';
import { withAliasHint } from '../alias-hint';
import { CONFIG_CATEGORY } from './command';

export class ConfigHelpCommand extends Command {
  static override paths = [['config'], ['cf']];
  static override usage = Command.Usage({
    category: CONFIG_CATEGORY,
    description: withAliasHint(
      'Show config subcommands.',
      ConfigHelpCommand.paths,
    ),
  });

  async execute(): Promise<void> {
    const [canonical = []] = ConfigHelpCommand.paths;
    this.context.stdout.write(
      renderNamespaceOverview({
        binaryName: this.cli.binaryName,
        invokedPath: this.path,
        canonicalPath: canonical,
        category: CONFIG_CATEGORY,
        definitions: this.cli.definitions(),
      }),
    );
  }
}

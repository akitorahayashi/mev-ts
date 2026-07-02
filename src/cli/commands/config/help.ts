import { Command } from 'clipanion';

export class ConfigHelpCommand extends Command {
  static override paths = [['config'], ['cf']];
  static override usage = Command.Usage({
    category: 'config',
    description: 'Show config subcommands. [aliases: cf]',
  });

  async execute(): Promise<void> {
    const [primaryPath = []] = ConfigHelpCommand.paths;
    const invokedPath = `${this.cli.binaryName} ${this.path.join(' ')}`;
    const canonicalPath = `${this.cli.binaryName} ${primaryPath.join(' ')}`;
    const entries = this.cli
      .definitions()
      .filter(
        (definition) =>
          definition.category?.trim() === 'config' &&
          definition.path !== canonicalPath,
      );

    process.stdout.write(`${invokedPath} <command>\n\n`);
    for (const entry of entries) {
      process.stdout.write(`  ${entry.usage}\n`);
      if (entry.description) {
        process.stdout.write(`    ${entry.description}\n`);
      }
      process.stdout.write('\n');
    }
  }
}

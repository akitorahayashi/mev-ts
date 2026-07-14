import { Command } from 'clipanion';
import { resolveIsTTY } from '../tty/style';
import { renderTargetList } from '../tty/targetlist';

export class ListCommand extends Command {
  static override paths = [['list'], ['ls']];
  static override usage = Command.Usage({
    description: 'List available targets. [aliases: ls]',
  });

  async execute(): Promise<void> {
    process.stdout.write(renderTargetList(resolveIsTTY()));
  }
}

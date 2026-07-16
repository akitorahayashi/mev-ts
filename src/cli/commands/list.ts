import { Command } from 'clipanion';
import { resolveIsTTY } from '../tty/style';
import { renderTargetList } from '../tty/targetlist';
import { withAliasHint } from './alias-hint';

export class ListCommand extends Command {
  static override paths = [['list'], ['ls']];
  static override usage = Command.Usage({
    description: withAliasHint('List available targets.', ListCommand.paths),
  });

  async execute(): Promise<void> {
    this.context.stdout.write(renderTargetList(resolveIsTTY()));
  }
}

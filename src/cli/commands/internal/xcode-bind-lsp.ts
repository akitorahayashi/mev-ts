import { Command, Option } from 'clipanion';
import { bindXcodeLsp } from '../../../internal/xcode/lsp-binding';
import { runInternalCommand } from './run';

export class InternalXcodeBindLspCommand extends Command {
  static override paths = [['internal', 'xcode', 'bind-lsp']];

  directory = Option.String({ required: false });
  scheme = Option.String('--scheme,-s');

  async execute() {
    return runInternalCommand(this, (run, write) =>
      bindXcodeLsp(
        run,
        { directory: this.directory ?? process.cwd(), scheme: this.scheme },
        write,
      ),
    );
  }
}

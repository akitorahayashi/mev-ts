import { Command, Option } from 'clipanion';
import { convertMarkdownToPdf } from '../../../internal/document/markdown-to-pdf';
import { runInternalCommand } from './command';

export class InternalDocumentMarkdownToPdfCommand extends Command {
  static override paths = [['internal', 'document', 'markdown-to-pdf']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      convertMarkdownToPdf(run, this.args, write),
    );
  }
}

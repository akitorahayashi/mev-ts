import { Command, Option } from 'clipanion';
import { convertPdfToMarkdown } from '../../../internal/document/pdf-to-markdown';
import { runInternalCommand } from './command';

export class InternalDocumentPdfToMarkdownCommand extends Command {
  static override paths = [['internal', 'document', 'pdf-to-markdown']];

  args = Option.Proxy();

  async execute() {
    return runInternalCommand(this, (run, write) =>
      convertPdfToMarkdown(run, this.args, write),
    );
  }
}

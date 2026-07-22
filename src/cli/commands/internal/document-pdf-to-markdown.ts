import { Command, Option } from 'clipanion';
import { convertPdfToMarkdown } from '../../../internal/document/pdf-to-markdown';
import { runInternalCommand } from './command';

export class InternalDocumentPdfToMarkdownCommand extends Command {
  static override paths = [['internal', 'document', 'pdf-to-markdown']];

  input = Option.String({ required: true });
  outputDirectory = Option.String('--output-dir,-o');

  async execute() {
    return runInternalCommand(this, (run, write, warn) =>
      convertPdfToMarkdown(
        run,
        { input: this.input, outputDirectory: this.outputDirectory },
        { write, warn },
      ),
    );
  }
}

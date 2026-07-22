import { tmpdir } from 'node:os';
import { Command, Option } from 'clipanion';
import { convertMarkdownToPdf } from '../../../internal/document/markdown-to-pdf';
import { runInternalCommand } from './command';

export class InternalDocumentMarkdownToPdfCommand extends Command {
  static override paths = [['internal', 'document', 'markdown-to-pdf']];

  input = Option.String({ required: true });
  outputDirectory = Option.String('--output-dir,-o');
  stylesheet = Option.String('--css,-c');
  marginTop = Option.String('--margin-top');
  marginRight = Option.String('--margin-right');
  marginBottom = Option.String('--margin-bottom');
  marginLeft = Option.String('--margin-left');

  async execute() {
    return runInternalCommand(this, (run, write, warn) =>
      convertMarkdownToPdf(
        run,
        {
          input: this.input,
          outputDirectory: this.outputDirectory,
          stylesheet: this.stylesheet,
          margins: {
            top: this.marginTop,
            right: this.marginRight,
            bottom: this.marginBottom,
            left: this.marginLeft,
          },
        },
        { tmpRoot: tmpdir(), write, warn },
      ),
    );
  }
}

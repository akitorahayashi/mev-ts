import { replaceFileAtomically } from '../../host/atomic-file';
import { type CommandRunner, formatCommandFailure } from '../../host/command';
import { DocumentConversionError } from './conversion-error';
import { planConversions } from './input-files';
import { runConversions } from './run-conversions';

export interface PdfToMarkdownRequest {
  readonly input: string;
  readonly outputDirectory?: string;
}

export interface PdfToMarkdownOptions {
  readonly write?: (message: string) => void;
  readonly warn?: (message: string) => void;
}

export async function convertPdfToMarkdown(
  run: CommandRunner,
  request: PdfToMarkdownRequest,
  options: PdfToMarkdownOptions = {},
): Promise<void> {
  const write = options.write ?? (() => {});
  const warn = options.warn ?? (() => {});
  const pairs = await planConversions(
    request.input,
    request.outputDirectory,
    ['.pdf'],
    '.md',
  );

  await runConversions(pairs, write, warn, async (pair) => {
    await replaceFileAtomically(pair.output, async (temporary) => {
      const result = await run.run('pdftotext', [
        '-enc',
        'UTF-8',
        '-nopgbrk',
        pair.input,
        temporary,
      ]);
      if (result.code !== 0) {
        throw new DocumentConversionError(
          formatCommandFailure(`Failed to convert '${pair.input}'`, result),
        );
      }
      if (result.stderr.trim()) warn(`${result.stderr.trim()}\n`);
    });
  });
}

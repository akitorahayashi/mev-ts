import type { CommandRunner } from '../../host/command';
import { DocumentConversionError } from './conversion-error';

export async function convertPdfToMarkdown(
  _run: CommandRunner,
  _tokens: readonly string[],
  _write: (message: string) => void = () => {},
): Promise<void> {
  throw new DocumentConversionError(
    'PDF-to-Markdown conversion is not implemented.',
  );
}

import type { CommandRunner } from '../../host/command';
import { DocumentConversionError } from './conversion-error';

export async function convertMarkdownToPdf(
  _run: CommandRunner,
  _tokens: readonly string[],
  _write: (message: string) => void = () => {},
): Promise<void> {
  throw new DocumentConversionError(
    'Markdown-to-PDF conversion is not implemented.',
  );
}

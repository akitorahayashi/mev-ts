import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorMessage } from '../../errors';
import { replaceFileAtomically } from '../../host/atomic-file';
import type { CommandRunner } from '../../host/command';
import { formatCommandFailure } from '../../host/command';
import { DocumentConversionError } from './conversion-error';
import { planConversions } from './input-files';

export interface PdfToMarkdownRequest {
  readonly input: string;
  readonly outputDirectory?: string;
}

export async function convertPdfToMarkdown(
  run: CommandRunner,
  request: PdfToMarkdownRequest,
  write: (message: string) => void = () => {},
  warn: (message: string) => void = () => {},
): Promise<void> {
  const pairs = await planConversions(
    request.input,
    request.outputDirectory,
    ['.pdf'],
    '.md',
  );
  const failures: string[] = [];

  for (const pair of pairs) {
    write(`Converting ${pair.input}...\n`);
    try {
      await mkdir(dirname(pair.output), { recursive: true });
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
      write(`Created ${pair.output}\n`);
    } catch (error) {
      const failure = `${pair.input}: ${errorMessage(error)}`;
      failures.push(failure);
      warn(`${failure}\n`);
    }
  }

  if (failures.length > 0) {
    throw new DocumentConversionError(
      `Failed to convert ${failures.length} file(s): ${failures.join('; ')}`,
    );
  }
}

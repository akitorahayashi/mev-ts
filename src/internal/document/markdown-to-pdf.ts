import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { errorMessage } from '../../errors';
import { runWithCleanup } from '../../host/cleanup-error';
import type { CommandRunner } from '../../host/command';
import {
  createBrowserPdfPrinter,
  type PdfPrinterFactory,
} from './browser-print';
import { DocumentConversionError } from './conversion-error';
import { planConversions } from './input-files';
import {
  type PageMargins,
  preparePandocAssets,
  renderMarkdownHtml,
} from './pandoc';

const MARGIN_PATTERN = /^\d+(?:\.\d+)?(?:mm|cm|in|px|pt)$/;

export interface MarkdownToPdfRequest {
  readonly input: string;
  readonly outputDirectory?: string;
  readonly stylesheet?: string;
  readonly margins: PageMargins;
}

async function validateStylesheet(path: string | undefined): Promise<void> {
  if (!path) return;
  const absolute = resolve(path);
  try {
    if ((await stat(absolute)).isFile()) return;
  } catch (error) {
    throw new DocumentConversionError(
      `Unable to read stylesheet '${absolute}': ${errorMessage(error)}`,
    );
  }
  throw new DocumentConversionError(
    `Stylesheet '${absolute}' must be a regular file.`,
  );
}

function validateMargins(margins: PageMargins): void {
  for (const [side, value] of Object.entries(margins)) {
    if (value !== undefined && !MARGIN_PATTERN.test(value)) {
      throw new DocumentConversionError(
        `Invalid ${side} margin '${value}'. Expected a number followed by mm, cm, in, px, or pt.`,
      );
    }
  }
}

export async function convertMarkdownToPdf(
  run: CommandRunner,
  request: MarkdownToPdfRequest,
  write: (message: string) => void = () => {},
  warn: (message: string) => void = () => {},
  createPrinter: PdfPrinterFactory = createBrowserPdfPrinter,
): Promise<void> {
  validateMargins(request.margins);
  await validateStylesheet(request.stylesheet);
  const pairs = await planConversions(
    request.input,
    request.outputDirectory,
    ['.md', '.markdown'],
    '.pdf',
  );

  const workspace = await mkdtemp(join(tmpdir(), 'mev-document-'));
  await runWithCleanup(
    async () => {
      const assets = await preparePandocAssets(
        workspace,
        request.stylesheet,
        request.margins,
      );
      const printer = await createPrinter();
      await runWithCleanup(
        async () => {
          const failures: string[] = [];
          for (const pair of pairs) {
            write(`Converting ${pair.input}...\n`);
            try {
              await mkdir(dirname(pair.output), { recursive: true });
              const rendered = await renderMarkdownHtml(
                run,
                pair.input,
                assets,
              );
              if (rendered.warning) warn(`${rendered.warning}\n`);
              await printer.print(rendered.html, pair.output);
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
        },
        () => printer.close(),
        'Failed to close the Markdown-to-PDF renderer.',
      );
    },
    () => rm(workspace, { force: true, recursive: true }),
    `Failed to remove document workspace ${workspace}.`,
  );
}

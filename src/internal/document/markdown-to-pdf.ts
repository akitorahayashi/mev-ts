import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
import { runConversions } from './run-conversions';

const MARGIN_PATTERN = /^\d+(?:\.\d+)?(?:mm|cm|in|px|pt)$/;

export interface MarkdownToPdfRequest {
  readonly input: string;
  readonly outputDirectory?: string;
  readonly stylesheet?: string;
  readonly margins: PageMargins;
}

export interface MarkdownToPdfOptions {
  /** Root for the short-lived conversion workspace; injected so tests confine it. */
  readonly tmpRoot: string;
  readonly write?: (message: string) => void;
  readonly warn?: (message: string) => void;
  readonly createPrinter?: PdfPrinterFactory;
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
  options: MarkdownToPdfOptions,
): Promise<void> {
  const write = options.write ?? (() => {});
  const warn = options.warn ?? (() => {});
  const createPrinter = options.createPrinter ?? createBrowserPdfPrinter;
  validateMargins(request.margins);
  await validateStylesheet(request.stylesheet);
  const pairs = await planConversions(
    request.input,
    request.outputDirectory,
    ['.md', '.markdown'],
    '.pdf',
  );

  const workspace = await mkdtemp(join(options.tmpRoot, 'mev-document-'));
  await runWithCleanup(
    async () => {
      const assets = await preparePandocAssets(
        workspace,
        request.stylesheet,
        request.margins,
      );
      const printer = await createPrinter();
      await runWithCleanup(
        () =>
          runConversions(pairs, write, warn, async (pair) => {
            const rendered = await renderMarkdownHtml(run, pair.input, assets);
            if (rendered.warning) warn(`${rendered.warning}\n`);
            await printer.print(rendered.html, pair.output);
          }),
        () => printer.close(),
        'Failed to close the Markdown-to-PDF renderer.',
      );
    },
    () => rm(workspace, { force: true, recursive: true }),
    `Failed to remove document workspace ${workspace}.`,
  );
}

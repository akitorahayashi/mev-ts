import mermaidSource from 'mermaid/dist/mermaid.min.js' with { type: 'text' };
import { type Browser, type BrowserContext, chromium } from 'playwright-core';
import { errorMessage } from '../../errors';
import { replaceFileAtomically } from '../../host/atomic-file';
import {
  runWithCleanup,
  throwWithCleanupError,
} from '../../host/cleanup-error';
import { DocumentConversionError } from './conversion-error';

interface MermaidPage {
  readonly mermaid: {
    initialize(options: {
      readonly securityLevel: 'strict';
      readonly startOnLoad: false;
      readonly theme: 'neutral';
    }): void;
    run(options: {
      readonly querySelector: string;
      readonly suppressErrors: false;
    }): Promise<void>;
  };
  readonly document: {
    readonly fonts: { readonly ready: Promise<unknown> };
    querySelectorAll(selector: string): Iterable<{
      textContent: string | null;
      querySelector(selector: string): { textContent: string | null } | null;
    }>;
  };
}

export interface PdfPrinter {
  print(html: string, output: string): Promise<void>;
  close(): Promise<void>;
}

export type PdfPrinterFactory = () => Promise<PdfPrinter>;

class PlaywrightPdfPrinter implements PdfPrinter {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {}

  async print(html: string, output: string): Promise<void> {
    const page = await this.context.newPage();
    await runWithCleanup(
      async () => {
        await page.setContent(html, { waitUntil: 'load' });
        await page.addScriptTag({ content: mermaidSource });
        await page.evaluate(async () => {
          const page = globalThis as unknown as MermaidPage;
          try {
            for (const diagram of page.document.querySelectorAll(
              'pre.mermaid',
            )) {
              const code = diagram.querySelector(':scope > code');
              if (code) diagram.textContent = code.textContent;
            }
            page.mermaid.initialize({
              securityLevel: 'strict',
              startOnLoad: false,
              theme: 'neutral',
            });
            await page.mermaid.run({
              querySelector: 'pre.mermaid',
              suppressErrors: false,
            });
          } catch (error) {
            let detail: string;
            if (error instanceof Error) {
              detail = `${error.name}: ${error.message}`;
            } else {
              try {
                detail = JSON.stringify(error);
              } catch {
                detail = String(error);
              }
            }
            throw new Error(`Mermaid rendering failed: ${detail}`);
          }
          await page.document.fonts.ready;
        });
        await page.emulateMedia({ media: 'print' });
        await replaceFileAtomically(output, async (temporary) => {
          await page.pdf({
            outline: true,
            path: temporary,
            preferCSSPageSize: true,
            printBackground: true,
            tagged: true,
          });
        });
      },
      () => page.close(),
      `Failed to close document page for ${output}.`,
    );
  }

  async close(): Promise<void> {
    await runWithCleanup(
      () => this.context.close(),
      () => this.browser.close(),
      'Failed to close the document browser.',
    );
  }
}

export async function createBrowserPdfPrinter(): Promise<PdfPrinter> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    throw new DocumentConversionError(
      `Unable to launch Google Chrome: ${errorMessage(error)}. Run 'mev make document' to install document dependencies.`,
    );
  }

  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route(/^https?:\/\//, (route) =>
      route.abort('blockedbyclient'),
    );
    return new PlaywrightPdfPrinter(browser, context);
  } catch (error) {
    const primary = new DocumentConversionError(
      `Unable to prepare the document browser: ${errorMessage(error)}`,
    );
    try {
      await browser.close();
    } catch (cleanupError) {
      throwWithCleanupError(
        primary,
        cleanupError,
        'Failed to close the document browser after setup failed.',
      );
    }
    throw primary;
  }
}

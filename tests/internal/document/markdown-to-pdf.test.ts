import { expect } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CommandOptions,
  CommandResult,
  CommandRunner,
} from '../../../src/host/command';
import type {
  PdfPrinter,
  PdfPrinterFactory,
} from '../../../src/internal/document/browser-print';
import { convertMarkdownToPdf } from '../../../src/internal/document/markdown-to-pdf';
import { sandboxedTest } from '../../fixtures/temporary-directory';

interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: CommandOptions;
}

class RecordingPrinter implements PdfPrinter {
  readonly prints: Array<{ html: string; output: string }> = [];
  closed = false;

  async print(html: string, output: string): Promise<void> {
    this.prints.push({ html, output });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const sandboxTest = sandboxedTest('markdown-pdf-');

sandboxTest(
  'conversion enables highlighting, MathML, embedded resources, and closes the printer',
  async (directory) => {
    const input = join(directory, 'document.md');
    const output = join(directory, 'output');
    const stylesheet = join(directory, 'custom.css');
    await Promise.all([
      writeFile(input, '# Document'),
      writeFile(stylesheet, 'body { color: black; }'),
    ]);

    const invocations: Invocation[] = [];
    const run: CommandRunner = {
      async run(command, args, options): Promise<CommandResult> {
        invocations.push({ command, args: [...args], options });
        return {
          code: 0,
          stdout: '<html><pre class="mermaid">graph LR</pre></html>',
          stderr: 'pandoc warning',
        };
      },
    };
    const printer = new RecordingPrinter();
    const createPrinter: PdfPrinterFactory = async () => printer;
    const stdout: string[] = [];
    const stderr: string[] = [];

    await convertMarkdownToPdf(
      run,
      {
        input,
        outputDirectory: output,
        stylesheet,
        margins: { top: '20mm' },
      },
      (message) => stdout.push(message),
      (message) => stderr.push(message),
      createPrinter,
    );

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe('pandoc');
    expect(invocations[0]?.args).toContain('--syntax-highlighting=pygments');
    expect(invocations[0]?.args).toContain('--mathml');
    expect(invocations[0]?.args).toContain('--embed-resources');
    expect(
      invocations[0]?.args.filter((arg) => arg.startsWith('--css=')),
    ).toHaveLength(3);
    expect(printer.prints).toEqual([
      {
        html: '<html><pre class="mermaid">graph LR</pre></html>',
        output: join(output, 'document.pdf'),
      },
    ]);
    expect(printer.closed).toBe(true);
    expect(stdout.join('')).toContain('Created');
    expect(stderr).toEqual(['pandoc warning\n']);
  },
);

sandboxTest(
  'invalid margins fail before starting dependencies',
  async (dir) => {
    const input = join(dir, 'document.md');
    await writeFile(input, '# Document');
    let printerCreated = false;
    const createPrinter: PdfPrinterFactory = async () => {
      printerCreated = true;
      return new RecordingPrinter();
    };
    const run: CommandRunner = {
      async run(): Promise<CommandResult> {
        throw new Error('pandoc must not run');
      },
    };

    await expect(
      convertMarkdownToPdf(
        run,
        { input, margins: { top: 'large' } },
        undefined,
        undefined,
        createPrinter,
      ),
    ).rejects.toThrow('Invalid top margin');
    expect(printerCreated).toBe(false);
  },
);

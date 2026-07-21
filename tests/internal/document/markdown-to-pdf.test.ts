import { expect } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
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

function luaFilterPath(args: readonly string[]): string {
  const filterArg = args.find((arg) => arg.startsWith('--lua-filter='));
  expect(filterArg).toBeString();
  if (filterArg === undefined) throw new Error('Missing Pandoc Lua filter.');
  return filterArg.slice('--lua-filter='.length);
}

sandboxTest(
  'conversion enables highlighting, MathML, local resource embedding, and closes the printer',
  async (directory) => {
    const input = join(directory, 'document.md');
    const output = join(directory, 'output');
    const stylesheet = join(directory, 'custom.css');
    await Promise.all([
      writeFile(input, '# Document'),
      writeFile(stylesheet, 'body { color: black; }'),
    ]);

    const invocations: Invocation[] = [];
    let filter: string | undefined;
    const run: CommandRunner = {
      async run(command, args, options): Promise<CommandResult> {
        invocations.push({ command, args: [...args], options });
        filter = await readFile(luaFilterPath(args), 'utf8');
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
    expect(filter).toContain('data-external');
    expect(filter).toContain('Remote HTML resources are not supported');
    // Load-bearing: stylesheets are applied. The exact count is incidental and
    // changes when a stylesheet is added, so assert presence, not the number.
    expect(
      invocations[0]?.args.filter((arg) => arg.startsWith('--css=')).length,
    ).toBeGreaterThan(0);
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
  'remote Markdown images are marked external before Pandoc embeds resources',
  async (directory) => {
    const input = join(directory, 'document.md');
    await writeFile(input, '![badge](https://example.com/badge.svg)');

    const invocations: Invocation[] = [];
    const run: CommandRunner = {
      async run(command, args, options): Promise<CommandResult> {
        invocations.push({ command, args: [...args], options });
        const filter = await readFile(luaFilterPath(args), 'utf8');
        expect(filter).toContain('function Image(image)');
        expect(filter).toContain('data-external');
        return {
          code: 0,
          stdout:
            '<html><img src="https://example.com/badge.svg" data-external="1"></html>',
          stderr: '',
        };
      },
    };
    const printer = new RecordingPrinter();

    await convertMarkdownToPdf(
      run,
      { input, margins: {} },
      undefined,
      undefined,
      async () => printer,
    );

    expect(invocations[0]?.args).toContain('--embed-resources');
    expect(printer.prints[0]?.html).toContain('data-external="1"');
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

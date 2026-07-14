import { expect } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from '../../../src/host/command';
import { convertPdfToMarkdown } from '../../../src/internal/document/pdf-to-markdown';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('pdf-markdown-');

sandboxTest(
  'conversion writes pdftotext output atomically',
  async (directory) => {
    const input = join(directory, 'document.pdf');
    const output = join(directory, 'output');
    await writeFile(input, '%PDF-test');
    let invocation: { command: string; args: readonly string[] } | undefined;
    const run: CommandRunner = {
      async run(command, args): Promise<CommandResult> {
        invocation = { command, args: [...args] };
        await writeFile(args.at(-1) ?? '', '# Extracted\n');
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    await convertPdfToMarkdown(run, { input, outputDirectory: output });

    expect(invocation?.command).toBe('pdftotext');
    expect(invocation?.args.slice(0, 4)).toEqual([
      '-enc',
      'UTF-8',
      '-nopgbrk',
      input,
    ]);
    expect(await readFile(join(output, 'document.md'), 'utf8')).toBe(
      '# Extracted\n',
    );
  },
);

sandboxTest('conversion surfaces pdftotext failures', async (directory) => {
  const input = join(directory, 'document.pdf');
  await writeFile(input, '%PDF-test');
  const run: CommandRunner = {
    async run(): Promise<CommandResult> {
      return { code: 1, stdout: '', stderr: 'invalid PDF' };
    },
  };

  await expect(convertPdfToMarkdown(run, { input })).rejects.toThrow(
    'invalid PDF',
  );
});

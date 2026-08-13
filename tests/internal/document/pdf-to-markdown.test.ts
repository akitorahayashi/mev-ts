import { expect } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

sandboxTest(
  'directory conversion runs at most four files concurrently',
  async (directory) => {
    const input = join(directory, 'inputs');
    const output = join(directory, 'output');
    await mkdir(input);
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        writeFile(join(input, `${name}.pdf`), '%PDF-test'),
      ),
    );

    const fourStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maxActive = 0;
    const run: CommandRunner = {
      async run(_command, args): Promise<CommandResult> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active === 4) fourStarted.resolve();
        await release.promise;
        await writeFile(args.at(-1) ?? '', '# Extracted\n');
        active -= 1;
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    const conversion = convertPdfToMarkdown(run, {
      input,
      outputDirectory: output,
    });
    await fourStarted.promise;
    expect(active).toBe(4);
    release.resolve();
    await conversion;

    expect(maxActive).toBe(4);
    expect(await readFile(join(output, 'e.md'), 'utf8')).toBe('# Extracted\n');
  },
);

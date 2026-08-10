import { expect } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocumentConversionError } from '../../../src/internal/document/conversion-error';
import { runConversions } from '../../../src/internal/document/run-conversions';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const test = sandboxedTest('run-conversions-');

test('a failing conversion warns and is summarized without stopping its siblings', async (dir) => {
  const names = ['a', 'b', 'c'] as const;
  const pairs = names.map((name) => ({
    input: join(dir, `${name}.md`),
    output: join(dir, 'out', `${name}.pdf`),
  }));
  const outputOf = (name: string) => join(dir, 'out', `${name}.pdf`);
  const written: string[] = [];
  const warnings: string[] = [];

  const failure = runConversions(
    pairs,
    () => {},
    (message) => warnings.push(message),
    async (pair) => {
      // The middle input fails; the loop must reach the one after it.
      if (pair.input.endsWith('b.md')) throw new Error('pandoc exploded');
      await writeFile(pair.output, 'converted');
      written.push(pair.output);
    },
  );

  await expect(failure).rejects.toBeInstanceOf(DocumentConversionError);
  expect(written).toEqual([outputOf('a'), outputOf('c')]);
  expect(await readFile(outputOf('c'), 'utf8')).toBe('converted');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('pandoc exploded');
});

test('the summarizing error counts every failure', async (dir) => {
  const pairs = ['a', 'b'].map((name) => ({
    input: join(dir, `${name}.md`),
    output: join(dir, 'out', `${name}.pdf`),
  }));

  const failure = runConversions(
    pairs,
    () => {},
    () => {},
    async (pair) => {
      throw new Error(`no converter for ${pair.input}`);
    },
  );

  await expect(failure).rejects.toThrow('Failed to convert 2 file(s)');
});

test('every conversion succeeding resolves without error', async (dir) => {
  const pair = { input: join(dir, 'a.md'), output: join(dir, 'out', 'a.pdf') };

  await expect(
    runConversions(
      [pair],
      () => {},
      () => {},
      async () => {
        await writeFile(pair.output, 'converted');
      },
    ),
  ).resolves.toBeUndefined();
});

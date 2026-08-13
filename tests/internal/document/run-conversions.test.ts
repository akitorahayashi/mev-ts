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

test('defaults to serial conversion', async (dir) => {
  const pairs = ['a', 'b', 'c'].map((name) => ({
    input: join(dir, `${name}.pdf`),
    output: join(dir, 'out', `${name}.md`),
  }));
  let active = 0;
  let maxActive = 0;

  await runConversions(
    pairs,
    () => {},
    () => {},
    async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(1);
      active -= 1;
    },
  );

  expect(maxActive).toBe(1);
});

test('opt-in concurrency is bounded and failure aggregation remains input ordered', async (dir) => {
  const pairs = ['a', 'b', 'c', 'd'].map((name) => ({
    input: join(dir, `${name}.pdf`),
    output: join(dir, 'out', `${name}.md`),
  }));
  const warnings: string[] = [];
  let active = 0;
  let maxActive = 0;

  const conversion = runConversions(
    pairs,
    () => {},
    (message) => warnings.push(message),
    async (pair) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(pair.input.endsWith('a.pdf') ? 5 : 1);
      active -= 1;
      throw new Error(`failed ${pair.input}`);
    },
    { concurrency: 2 },
  );

  await expect(conversion).rejects.toThrow(
    `Failed to convert 4 file(s): ${pairs
      .map((pair) => `${pair.input}: failed ${pair.input}`)
      .join('; ')}`,
  );
  expect(maxActive).toBe(2);
  expect(warnings.sort()).toEqual(
    pairs.map((pair) => `${pair.input}: failed ${pair.input}\n`).sort(),
  );
});

import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planConversions } from '../../../src/internal/document/input-files';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('document-inputs-');

sandboxTest(
  'directory conversion preserves relative paths and excludes its output tree',
  async (directory) => {
    const input = join(directory, 'input');
    const nested = join(input, 'nested');
    const output = join(input, 'generated');
    await Promise.all([
      mkdir(nested, { recursive: true }),
      mkdir(output, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(input, 'root.md'), '# Root'),
      writeFile(join(nested, 'child.markdown'), '# Child'),
      writeFile(join(output, 'stale.md'), '# Stale'),
    ]);

    const pairs = await planConversions(
      input,
      output,
      ['.md', '.markdown'],
      '.pdf',
    );

    expect(pairs).toEqual([
      {
        input: join(input, 'nested', 'child.markdown'),
        output: join(output, 'nested', 'child.pdf'),
      },
      {
        input: join(input, 'root.md'),
        output: join(output, 'root.pdf'),
      },
    ]);
  },
);

sandboxTest('directory conversion rejects output collisions', async (dir) => {
  await Promise.all([
    writeFile(join(dir, 'same.md'), '# First'),
    writeFile(join(dir, 'same.markdown'), '# Second'),
  ]);

  await expect(
    planConversions(dir, join(dir, 'out'), ['.md', '.markdown'], '.pdf'),
  ).rejects.toThrow('both map to');
});

sandboxTest(
  'directory conversion rejects case-only macOS collisions',
  async (dir) => {
    await Promise.all([
      writeFile(join(dir, 'Report.md'), '# First'),
      writeFile(join(dir, 'report.markdown'), '# Second'),
    ]);

    await expect(
      planConversions(dir, join(dir, 'out'), ['.md', '.markdown'], '.pdf'),
    ).rejects.toThrow('both map to');
  },
);

sandboxTest(
  'directory conversion rejects canonical Unicode macOS collisions',
  async (dir) => {
    await Promise.all([
      writeFile(join(dir, 'café.md'), '# First'),
      writeFile(join(dir, 'cafe\u0301.markdown'), '# Second'),
    ]);

    await expect(
      planConversions(dir, join(dir, 'out'), ['.md', '.markdown'], '.pdf'),
    ).rejects.toThrow('both map to');
  },
);

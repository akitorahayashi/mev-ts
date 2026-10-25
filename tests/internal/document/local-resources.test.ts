import { expect } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { embedLocalResources } from '../../../src/internal/document/local-resources';
import { convertMarkdownToPdf } from '../../../src/internal/document/markdown-to-pdf';
import { sandboxedTest } from '../../fixtures/temporary-directory';

const sandboxTest = sandboxedTest('local-resources-');

function dataPayloads(html: string): string[] {
  return [...html.matchAll(/data:text\/css;base64,([A-Za-z\d+/=]+)/g)].map(
    (match) => Buffer.from(match[1] ?? '', 'base64').toString('utf8'),
  );
}

sandboxTest(
  'local styles, recursive imports, images and fonts are embedded relative to their owner',
  async (directory) => {
    const nested = join(directory, 'nested');
    await mkdir(nested);
    await writeFile(join(directory, 'image space.png'), 'image-bytes');
    await writeFile(join(nested, 'font.woff2'), 'font-bytes');
    await writeFile(
      join(nested, 'child.css'),
      '@font-face {src:url(font.woff2)} .x{background:url(../image%20space.png)}',
    );
    await writeFile(
      join(directory, 'parent.css'),
      '@import "nested/child.css" print; body{color:black}',
    );
    const result = await embedLocalResources(
      '<link rel="stylesheet" href="parent.css"><img src="image%20space.png"><style>.x {background:url(image%20space.png)}</style><p style="background:url(image%20space.png)">Local</p>',
      join(directory, 'input.md'),
    );
    const [parent] = dataPayloads(result);
    expect(parent).toContain('print;');
    const [child] = dataPayloads(parent ?? '');
    expect(child).toContain(Buffer.from('font-bytes').toString('base64'));
    expect(child).toContain(Buffer.from('image-bytes').toString('base64'));
    expect(result).toContain(
      `src="data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}"`,
    );
    expect(result).not.toContain('url(image');
  },
);

for (const css of [
  '@import "https://example.test/style.css";',
  '@import url(//example.test/style.css);',
  'body{background:url(https://example.test/image)}',
  'body{--background:url(https://example.test/image);background:var(--background)}',
  'body{background:image-set("https://example.test/image" 1x)}',
  'body{background:url("h\\74tps://example.test/image")}',
]) {
  sandboxTest(`nonlocal CSS dependencies fail: ${css}`, async (directory) => {
    await expect(
      embedLocalResources(`<style>${css}</style>`, join(directory, 'input.md')),
    ).rejects.toThrow();
  });
}

sandboxTest(
  'remote images remain external while nonlocal stylesheet links fail',
  async (directory) => {
    const input = join(directory, 'input.md');
    expect(
      await embedLocalResources(
        '<img src="//example.test/image"><a href="https://example.test">Link</a>',
        input,
      ),
    ).toContain('href="https://example.test"');
    await expect(
      embedLocalResources(
        '<link rel="stylesheet" href="https&#58;//example.test/style.css">',
        input,
      ),
    ).rejects.toThrow('Nonlocal');
  },
);

sandboxTest(
  'cyclic imports and missing local resources fail without changing inputs',
  async (directory) => {
    const path = join(directory, 'a.css');
    const css = '@import "b.css";';
    await writeFile(path, css);
    await writeFile(join(directory, 'b.css'), '@import "a.css";');
    await expect(
      embedLocalResources(
        '<link rel="stylesheet" href="a.css">',
        join(directory, 'input.md'),
      ),
    ).rejects.toThrow('Cyclic');
    expect(await readFile(path, 'utf8')).toBe(css);
    await expect(
      embedLocalResources(
        '<img src="missing.png">',
        join(directory, 'input.md'),
      ),
    ).rejects.toThrow('Unable to resolve');
  },
);

sandboxTest(
  'data CSS imports are resolved with the same nonlocal policy',
  async (directory) => {
    const imported = Buffer.from(
      '@import "https://example.test/a.css";',
    ).toString('base64');
    await expect(
      embedLocalResources(
        `<style>@import url(data:text/css;base64,${imported});</style>`,
        join(directory, 'input.md'),
      ),
    ).rejects.toThrow('Nonlocal');
  },
);

sandboxTest(
  'failed resource resolution cleans the conversion workspace and closes the renderer',
  async (directory) => {
    const input = join(directory, 'input.md');
    const stylesheet = join(directory, 'custom.css');
    await writeFile(input, '# Local');
    await writeFile(stylesheet, '@import "https://example.test/x.css";');
    let closed = false;
    let printed = false;
    await expect(
      convertMarkdownToPdf(
        {
          async run(_command, args) {
            expect(args).not.toContain('--embed-resources');
            return {
              code: 0,
              stdout: `<link rel="stylesheet" href="${pathToFileURL(stylesheet).href}">`,
              stderr: '',
            };
          },
        },
        { input, stylesheet, margins: {} },
        {
          tmpRoot: directory,
          createPrinter: async () => ({
            async print() {
              printed = true;
            },
            async close() {
              closed = true;
            },
          }),
        },
      ),
    ).rejects.toThrow('Nonlocal');
    expect(closed).toBe(true);
    expect(printed).toBe(false);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith('mev-document-'),
      ),
    ).toEqual([]);
  },
);

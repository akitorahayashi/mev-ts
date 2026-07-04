import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMev } from '../../scripts/build';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

async function rootCompilerWorkFiles(): Promise<string[]> {
  return (await readdir(process.cwd())).filter((name) =>
    name.includes('bun-build'),
  );
}

test('buildMev writes the requested output from an isolated workspace', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const outfile = join(dir, 'mev');

      await buildMev({ projectRoot: process.cwd(), outfile });

      expect(await Bun.file(outfile).exists()).toBe(true);
      expect(await rootCompilerWorkFiles()).toEqual([]);
    },
    { prefix: 'build-' },
  );
});

test('buildMev keeps concurrent outputs isolated', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const first = join(dir, 'first');
      const second = join(dir, 'second');

      await Promise.all([
        buildMev({ projectRoot: process.cwd(), outfile: first }),
        buildMev({ projectRoot: process.cwd(), outfile: second }),
      ]);

      expect(await Bun.file(first).exists()).toBe(true);
      expect(await Bun.file(second).exists()).toBe(true);
      expect(await rootCompilerWorkFiles()).toEqual([]);
    },
    { prefix: 'build-concurrent-' },
  );
});

test('buildMev preserves build failure when cleanup also fails', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      await expect(
        buildMev({
          projectRoot: join(dir, 'missing-project'),
          outfile: join(dir, 'mev'),
        }),
      ).rejects.toThrow(/bun build failed|ModuleNotFound|no such file/i);
    },
    { prefix: 'build-failure-' },
  );
});

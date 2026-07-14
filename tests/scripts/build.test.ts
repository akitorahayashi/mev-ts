import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildMev } from '../../scripts/build';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

async function rootCompilerWorkFiles(): Promise<string[]> {
  return (await readdir(process.cwd())).filter((name) =>
    name.includes('bun-build'),
  );
}

test('buildMev runs bun build from an isolated workspace', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const outfile = join(dir, 'mev');
      const invocations: Array<{
        args: readonly string[];
        cwd: string;
        stdio: string;
      }> = [];

      await buildMev({
        projectRoot: process.cwd(),
        outfile,
        stdio: 'ignore',
        async runBuildCommand(invocation) {
          invocations.push(invocation);
          return 0;
        },
      });

      expect(invocations).toEqual([
        {
          args: [resolve(process.cwd(), 'scripts/generate-assets.ts')],
          cwd: process.cwd(),
          stdio: 'ignore',
        },
        {
          args: [
            'build',
            resolve(process.cwd(), 'src/main.ts'),
            '--compile',
            '--outfile',
            outfile,
          ],
          cwd: expect.stringContaining('mev-build-'),
          stdio: 'ignore',
        },
      ]);
      expect(invocations[1]?.cwd).not.toBe(process.cwd());
      expect(await rootCompilerWorkFiles()).toEqual([]);
    },
    { prefix: 'build-' },
  );
});

test('buildMev keeps concurrent workspaces isolated', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const first = join(dir, 'first');
      const second = join(dir, 'second');
      const workspaces: string[] = [];

      await Promise.all([
        buildMev({
          projectRoot: process.cwd(),
          outfile: first,
          stdio: 'ignore',
          async runBuildCommand(invocation) {
            workspaces.push(invocation.cwd);
            return 0;
          },
        }),
        buildMev({
          projectRoot: process.cwd(),
          outfile: second,
          stdio: 'ignore',
          async runBuildCommand(invocation) {
            workspaces.push(invocation.cwd);
            return 0;
          },
        }),
      ]);

      const buildWorkspaces = workspaces.filter((cwd) =>
        cwd.includes('mev-build-'),
      );
      expect(buildWorkspaces).toHaveLength(2);
      expect(new Set(buildWorkspaces).size).toBe(2);
      expect(await rootCompilerWorkFiles()).toEqual([]);
    },
    { prefix: 'build-concurrent-' },
  );
});

test('buildMev preserves build failure when cleanup also fails', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const cleanupError = new Error('cleanup failed');
      let caught: unknown;

      let calls = 0;
      try {
        await buildMev({
          projectRoot: join(dir, 'missing-project'),
          outfile: join(dir, 'mev'),
          stdio: 'ignore',
          async runBuildCommand() {
            // Codegen (first) succeeds; the compile (second) fails.
            calls += 1;
            return calls === 1 ? 0 : 1;
          },
          async removeWorkspace() {
            throw cleanupError;
          },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).message)).toBe(
        'bun build failed with exit code 1',
      );
      await expect(
        Promise.resolve(
          (caught as Error & { cleanupError?: unknown }).cleanupError,
        ),
      ).resolves.toBe(cleanupError);
    },
    { prefix: 'build-failure-' },
  );
});

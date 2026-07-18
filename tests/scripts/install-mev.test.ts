import { expect, test } from 'bun:test';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installLocalMev } from '../../scripts/install-mev';
import { withTemporaryDirectory } from '../fixtures/temporary-directory';

test('installLocalMev installs a Bun-targeted JavaScript bundle', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const installDir = join(dir, 'bin');
      const invocations: Array<{
        args: readonly string[];
        cwd: string;
        stdio: string;
      }> = [];

      const dest = await installLocalMev({
        projectRoot: process.cwd(),
        installDir,
        stdio: 'ignore',
        async runBuildCommand(invocation) {
          invocations.push(invocation);
          const outfileIndex = invocation.args.indexOf('--outfile');
          const outfile = invocation.args[outfileIndex + 1];
          if (outfileIndex >= 0 && outfile !== undefined) {
            await writeFile(
              outfile,
              '#!/usr/bin/env bun\nconsole.log("mev")\n',
            );
          }
          return 0;
        },
      });

      expect(dest).toBe(join(installDir, 'mev'));
      expect(invocations).toHaveLength(2);
      expect(invocations[0]).toEqual({
        args: [resolve(process.cwd(), 'scripts/generate-assets.ts')],
        cwd: process.cwd(),
        stdio: 'ignore',
      });
      expect(invocations[1]?.args).toContain('--target');
      expect(invocations[1]?.args).toContain('bun');
      expect(invocations[1]?.args).not.toContain('--compile');
      expect(await readFile(dest, 'utf8')).toBe(
        '#!/usr/bin/env bun\nconsole.log("mev")\n',
      );
      expect((await stat(dest)).mode & 0o777).toBe(0o755);
      expect(await readdir(installDir)).toEqual(['mev']);
    },
    { prefix: 'install-mev-js-' },
  );
});

test('installLocalMev preserves the installed command when bundle build fails', async () => {
  await withTemporaryDirectory(
    async (dir) => {
      const installDir = join(dir, 'bin');
      const dest = join(installDir, 'mev');
      await mkdir(installDir, { recursive: true });
      await writeFile(dest, 'release binary');

      await expect(
        installLocalMev({
          projectRoot: process.cwd(),
          installDir,
          stdio: 'ignore',
          async runBuildCommand(invocation) {
            return invocation.args.includes('build') ? 1 : 0;
          },
        }),
      ).rejects.toThrow('bun build failed with exit code 1');

      expect(await readFile(dest, 'utf8')).toBe('release binary');
      expect(await readdir(installDir)).toEqual(['mev']);
    },
    { prefix: 'install-mev-build-failure-' },
  );
});

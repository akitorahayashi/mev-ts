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
      // Load-bearing contract: codegen precedes asset validation precedes the
      // bundle build; assert those steps and their relative order rather than an
      // exact count/positions so an added preparatory step does not break this.
      const kinds = invocations.map((invocation) => {
        if (invocation.args.some((arg) => arg.endsWith('generate-assets.ts'))) {
          return 'codegen';
        }
        if (invocation.args.some((arg) => arg.endsWith('validate-assets.ts'))) {
          return 'validate';
        }
        return invocation.args.includes('build') ? 'build' : 'other';
      });
      const codegen = kinds.indexOf('codegen');
      const validate = kinds.indexOf('validate');
      const build = kinds.indexOf('build');
      expect(codegen).toBeGreaterThanOrEqual(0);
      expect(codegen).toBeLessThan(validate);
      expect(validate).toBeLessThan(build);
      expect(invocations[codegen]?.args).toEqual([
        resolve(process.cwd(), 'scripts/generate-assets.ts'),
      ]);
      expect(invocations[codegen]?.cwd).toBe(process.cwd());
      // The build produces Bun's single-file JS bundle, not a compiled binary.
      expect(invocations[build]?.args).toContain('--target');
      expect(invocations[build]?.args).toContain('bun');
      expect(invocations[build]?.args).not.toContain('--compile');
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

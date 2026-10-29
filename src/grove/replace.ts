import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProvisioningError } from '../errors';
import { releaseBinaryPath } from '../github/release';
import { runWithCleanup } from '../host/cleanup-error';
import { runProcessCapture } from '../host/command-run';
import type { Context } from '../host/context';

/**
 * Replace the catalog at `dest` with `rendered` through the installed `gv`,
 * which converges the repositories leaving the catalog and writes `dest` only
 * when all of them converged. Resolves to grove's report lines. Grove prints
 * blocked reasons on stdout, so a failure carries both streams.
 */
export async function replaceConfig(
  rendered: string,
  dest: string,
  context: Context,
): Promise<string[]> {
  await mkdir(dirname(dest), { recursive: true });
  const workspace = await mkdtemp(join(context.tmpRoot, 'mev-grove-'));
  return runWithCleanup(
    async () => {
      const candidate = join(workspace, 'candidate.toml');
      await writeFile(candidate, rendered, { flag: 'wx' });
      const result = await runProcessCapture(
        context.commands,
        releaseBinaryPath(context.home, 'gv'),
        ['--config', dest, 'replace', candidate],
      );
      if (result.code !== 0) {
        const output = [result.stdout.trim(), result.stderr.trim()]
          .filter((stream) => stream !== '')
          .join('\n');
        throw new ProvisioningError(
          `Grove did not replace ${dest}; gv replace exited with code ${result.code}${output ? `:\n${output}` : '.'}`,
        );
      }
      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    },
    () => rm(workspace, { force: true, recursive: true }),
    `Failed to remove the Grove replacement workspace ${workspace}.`,
  );
}

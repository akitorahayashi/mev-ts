import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { releaseBinaryPath } from '../github/release';
import { runWithCleanup } from '../host/cleanup-error';
import { runProcessStep } from '../host/command-run';
import type { Context } from '../host/context';

/**
 * Validate `rendered` with the installed `gv` before it replaces `dest`. The
 * candidate sits beside `dest` so relative repository paths resolve against the
 * same root, and its unique stem pairs with no sibling override, so grove checks
 * the base file alone.
 */
export async function validateConfig(
  rendered: string,
  dest: string,
  context: Context,
): Promise<void> {
  const candidate = join(
    dirname(dest),
    `.${basename(dest)}.${randomUUID()}.toml`,
  );
  await mkdir(dirname(dest), { recursive: true });
  await runWithCleanup(
    async () => {
      await writeFile(candidate, rendered, { flag: 'wx' });
      await runProcessStep(
        context.commands,
        releaseBinaryPath(context.home, 'gv'),
        ['validate', '--config', candidate],
        `Grove rejected the rendered ${dest}; gv validate exited`,
      );
    },
    () => rm(candidate, { force: true }),
    `Failed to remove the Grove validation candidate ${candidate}.`,
  );
}

import { mkdir, rmdir, symlink, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../../errors';
import { runCapture } from '../../../git/run';
import { lstatIfPresent } from '../../../host/absence';
import { throwWithCleanupError } from '../../../host/cleanup-error';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';

/**
 * Agent context lives in `.tmp`. Every worktree's `.tmp` is an absolute link
 * to the main worktree's, so whatever any worktree writes there has one home
 * that survives the worktree's removal.
 */
export const SHARED_TMP = '.tmp';

export function isSharedTmpPath(path: string): boolean {
  return (
    path === SHARED_TMP ||
    path === `${SHARED_TMP}/` ||
    path.startsWith(`${SHARED_TMP}/`)
  );
}

export interface LinkTarget {
  readonly branch: string;
  /** The tree the worktree will hold, inspected before it exists. */
  readonly treeish: string;
}

/**
 * Refuse, before any worktree exists, the states a link would silently
 * override: a tracked `.tmp` on either side, or a main `.tmp` that is not a
 * directory to share.
 */
export async function checkSharedTmp(
  run: CommandRunner,
  mainPath: string,
  targets: readonly LinkTarget[],
): Promise<void> {
  const tracked = await runCapture(run, [
    '-C',
    mainPath,
    'ls-files',
    '-z',
    '--',
    SHARED_TMP,
  ]);
  if (tracked.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git ls-files failed', tracked),
    );
  }
  if (tracked.stdout !== '') {
    throw new CommandLineError(
      `The main worktree tracks '${SHARED_TMP}', so it cannot be shared. Stop tracking it and ignore it first.`,
    );
  }

  const source = join(mainPath, SHARED_TMP);
  const entry = await lstatIfPresent(source);
  if (entry !== null && !entry.isDirectory()) {
    throw new CommandLineError(
      `'${source}' is not a directory, so it cannot be shared. Move it aside first.`,
    );
  }

  for (const target of targets) {
    const listed = await runCapture(run, [
      '-C',
      mainPath,
      'ls-tree',
      '-z',
      '--name-only',
      target.treeish,
      '--',
      SHARED_TMP,
    ]);
    if (listed.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure('git ls-tree failed', listed),
      );
    }
    if (listed.stdout !== '') {
      throw new CommandLineError(
        `Branch '${target.branch}' tracks '${SHARED_TMP}', so it cannot be linked to the shared one.`,
      );
    }
  }
}

/**
 * Link each worktree's `.tmp` to the main worktree's. All or nothing: a link
 * that would not be ignored would show up as an untracked file and invite a
 * commit of the link, so the links made so far are undone and the failure
 * names the rule to change.
 */
export async function linkSharedTmp(
  run: CommandRunner,
  mainPath: string,
  worktrees: readonly string[],
): Promise<void> {
  const source = join(mainPath, SHARED_TMP);
  const createdSource = (await lstatIfPresent(source)) === null;
  const links: string[] = [];

  try {
    if (createdSource) await mkdir(source);
    for (const worktree of worktrees) {
      const destination = join(worktree, SHARED_TMP);
      // checkSharedTmp ruled out a tracked `.tmp`, so anything here arrived
      // since; it is not replaced.
      if ((await lstatIfPresent(destination)) !== null) {
        throw new ProvisioningError(
          `'${destination}' already exists; it is left in place rather than replaced by the shared link.`,
        );
      }
      await symlink(source, destination);
      links.push(destination);
      await assertIgnored(run, worktree);
    }
  } catch (error) {
    try {
      for (const link of links.reverse()) await unlink(link);
      if (createdSource) await rmdir(source);
    } catch (cleanupError) {
      throwWithCleanupError(
        error,
        cleanupError,
        `Failed to undo the shared '${SHARED_TMP}' links.`,
      );
    }
    throw error;
  }
}

/**
 * `--quiet` decides and `--verbose` only explains: a path matched by a negated
 * rule is not ignored, yet `--verbose` still reports that match with exit 0.
 */
async function assertIgnored(
  run: CommandRunner,
  worktree: string,
): Promise<void> {
  const result = await runCapture(run, [
    '-C',
    worktree,
    'check-ignore',
    '--quiet',
    '--no-index',
    '--',
    SHARED_TMP,
  ]);
  if (result.code === 0) return;
  if (result.code !== 1) {
    throw new ProvisioningError(
      formatCommandFailure('git check-ignore failed', result),
    );
  }

  const verbose = await runCapture(run, [
    '-C',
    worktree,
    'check-ignore',
    '--verbose',
    '--no-index',
    '--',
    SHARED_TMP,
  ]);
  const rule = verbose.code === 0 ? verbose.stdout.split('\t')[0] : '';
  throw new CommandLineError(
    `The shared '${SHARED_TMP}' link in '${basename(worktree)}' would not be ignored${rule ? ` (last matching rule ${rule})` : ''}. Ignore '/${SHARED_TMP}', without a trailing slash, in the global ignore or the branch's .gitignore.`,
  );
}

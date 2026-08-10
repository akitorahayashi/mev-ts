import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { lstatIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';

/**
 * Create a fresh sibling staging directory for a same-parent atomic swap of
 * `path`. The parent is created and realpath-resolved first so the eventual
 * rename stays on the target's filesystem (atomic on APFS).
 */
export async function transactionDirectory(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const parent = await realpath(dirname(path));
  return mkdtemp(join(parent, `.${basename(path)}.`));
}

/** The six random characters `mkdtemp` substitutes for the template's `XXXXXX`. */
const MKDTEMP_SUFFIX = /\.[A-Za-z0-9]{6}$/;

/** Shortest name `transactionDirectory` can produce: dot, one-character basename, dot, six characters. */
const SHORTEST_ARTIFACT = 1 + 1 + 1 + 6;

/**
 * Whether a directory entry is a staging directory left behind by
 * `transactionDirectory`. Lives beside the generator so a change to the naming
 * reaches every consumer: a pruner working from its own copy of the pattern
 * would stop recognizing retained transactions and delete them as strays.
 */
export function isTransactionArtifact(name: string): boolean {
  return (
    name.startsWith('.') &&
    MKDTEMP_SUFFIX.test(name) &&
    name.length >= SHORTEST_ARTIFACT
  );
}

export interface SwapPaths {
  readonly dest: string;
  readonly staged: string;
  readonly backup: string;
}

/**
 * Move `dest`'s current contents aside to `backup`, then move `staged` into
 * `dest`. If installing `staged` fails, the previous contents are restored from
 * `backup`; if that restore also fails, `onRetain` is invoked (so the caller
 * keeps the transaction for recovery) and an AggregateError naming both failures
 * is thrown. Reached through `withSwapTransaction`, so this safety-critical
 * rollback dance lives in one place. Not crash-safe: a crash between the two
 * renames leaves `dest` absent with the previous contents at `backup`.
 */
async function swapWithBackup(
  { dest, staged, backup }: SwapPaths,
  onRetain: () => void,
): Promise<void> {
  await rename(dest, backup);
  try {
    await rename(staged, dest);
  } catch (error) {
    try {
      await rename(backup, dest);
    } catch (restoreError) {
      onRetain();
      throw new AggregateError(
        [error, restoreError],
        `Failed to replace ${dest} and restore its previous contents. Previous contents remain in ${backup}.`,
      );
    }
    throw error;
  }
}

export interface SwapTransaction {
  /**
   * Sibling path the caller builds the desired content at. Same parent as the
   * destination, so installing it is a rename rather than a cross-device copy.
   */
  readonly staged: string;
  /**
   * Install the staged content at the destination. A single rename is used when
   * it can atomically replace what is there; otherwise the current contents move
   * aside to a backup first and are restored if the install fails.
   */
  install(): Promise<void>;
}

/**
 * Run `build` inside a staging transaction for `path` and remove the transaction
 * afterwards, unless a failed restore left the previous contents in it — those
 * are retained deliberately so they stay recoverable. Owns the staging
 * directory, the backup path, the retention decision, and the cleanup label, so
 * the file, symlink, and directory primitives keep only their own content and
 * idempotence logic.
 */
export async function withSwapTransaction<T>(
  path: string,
  kind: string,
  build: (transaction: SwapTransaction) => Promise<T>,
): Promise<T> {
  const directory = await transactionDirectory(path);
  const staged = join(directory, 'staged');
  const backup = join(directory, 'backup');
  let retain = false;

  return runWithCleanup(
    () =>
      build({
        staged,
        async install() {
          // A rename replaces the destination atomically unless a directory is
          // involved on either side: it refuses to overwrite an existing
          // directory, and a staged directory cannot land on an existing entry
          // of any kind. Those cases go through the backup dance instead.
          const [current, replacement] = await Promise.all([
            lstatIfPresent(path),
            lstatIfPresent(staged),
          ]);
          if (
            !current ||
            (!current.isDirectory() && !replacement?.isDirectory())
          ) {
            await rename(staged, path);
            return;
          }
          await swapWithBackup({ dest: path, staged, backup }, () => {
            retain = true;
          });
        },
      }),
    async () => {
      if (!retain) await rm(directory, { force: true, recursive: true });
    },
    `Failed to clean up ${kind} transaction for ${path}.`,
  );
}

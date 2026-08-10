import { mkdir, mkdtemp, realpath, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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
 * is thrown. Shared by the symlink and directory-replacement primitives so this
 * safety-critical rollback dance lives in one place. Not crash-safe: a crash
 * between the two renames leaves `dest` absent with the previous contents at
 * `backup`.
 */
export async function swapWithBackup(
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

import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ProvisioningError } from '../errors';
import { readDirentsIfPresent } from './absence';
import { runWithCleanup } from './cleanup-error';
import {
  finishTransaction,
  prepareTransactionRecord,
  publishTransaction,
  type TransactionRecord,
} from './transaction-record';

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
 * rollback dance lives in one place. The durable record supports restart recovery.
 */
async function swapWithBackup(
  { dest, staged, backup }: SwapPaths,
  onRetain: () => void,
  onBackup: () => Promise<void>,
): Promise<void> {
  await rename(dest, backup);
  try {
    await onBackup();
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

export interface TransactionOptions {
  readonly home: string;
  readonly onBoundary?: (
    phase: 'prepared' | 'backed-up' | 'replaced' | 'published',
    paths: SwapPaths,
  ) => Promise<void>;
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
  options: TransactionOptions,
): Promise<T> {
  for (const entry of (await readDirentsIfPresent(dirname(path))) ?? []) {
    if (
      entry.isDirectory() &&
      isTransactionArtifact(entry.name) &&
      entry.name.startsWith(`.${basename(path)}.`)
    ) {
      throw new ProvisioningError(
        `Unrecorded or unfinished transaction at ${join(dirname(path), entry.name)}; recovery under home ownership is required before replacement.`,
      );
    }
  }
  const directory = await transactionDirectory(path);
  const staged = join(directory, 'staged');
  const backup = join(directory, 'backup');
  const dest = join(dirname(directory), basename(path));
  let retain = false;
  let recording = false;
  let record: TransactionRecord | undefined;
  const paths = { dest, staged, backup };

  return runWithCleanup(
    () =>
      build({
        staged,
        async install() {
          recording = true;
          record = await prepareTransactionRecord(
            options.home,
            directory,
            dest,
            staged,
            backup,
          );
          await options.onBoundary?.('prepared', paths);
          if (record.strategy === 'atomic') await rename(staged, dest);
          else
            await swapWithBackup(
              paths,
              () => {
                retain = true;
              },
              async () => {
                await options.onBoundary?.('backed-up', paths);
              },
            );
          await options.onBoundary?.('replaced', paths);
          record = await publishTransaction(record);
          await options.onBoundary?.('published', paths);
        },
      }),
    async () => {
      if (retain) return;
      if (record) await finishTransaction(record);
      else if (!recording)
        await rm(directory, { force: true, recursive: true });
    },
    `Failed to clean up ${kind} transaction for ${path}.`,
  );
}

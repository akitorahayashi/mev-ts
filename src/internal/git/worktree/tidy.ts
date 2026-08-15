import { CommandLineError } from '../../../errors';
import { runStep } from '../../../git/run';
import type { CommandRunner } from '../../../host/command';
import { resolveDefaultBranch } from '../default-branch';
import {
  type Entry,
  type Inventory,
  isCurrentDirectory,
  readInventory,
} from './inventory';
import { displayName } from './layout';
import { readDirtyCount, readTracking, type Tracking } from './state';

export type Verdict =
  | { readonly kind: 'remove' }
  | { readonly kind: 'skip'; readonly reason: string };

export interface Decision {
  readonly entry: Entry;
  readonly verdict: Verdict;
}

/**
 * This command prunes origin and nothing else, so a missing upstream is fresh
 * evidence only for an origin branch. Any other upstream reports gone from
 * local state of unknown age.
 */
const ORIGIN_PREFIX = 'refs/remotes/origin/';

/**
 * The worktrees whose branch tracked an origin branch that no longer exists,
 * with the safety every free check can establish. A deleted upstream is the
 * only merge evidence available — `--merged` misses a squash merge, which is
 * the case this exists for — so it decides membership, and the checks here
 * decide nothing more than whether removal is safe on its own terms.
 *
 * Kept pure so the whole skip table is one testable function; the two gates
 * that need I/O are applied by the driver afterwards, once the free ones have
 * already thinned the candidates.
 */
export function classify(
  inventory: Inventory,
  tracking: ReadonlyMap<string, Tracking>,
  defaultBranch: string,
): readonly Decision[] {
  const decisions: Decision[] = [];
  for (const entry of inventory.entries) {
    if (entry.branch === null) continue;
    const state = tracking.get(entry.branch);
    if (state === undefined || !state.gone) continue;

    decisions.push({
      entry,
      verdict: verdictFor(inventory, entry, state, defaultBranch),
    });
  }
  return decisions;
}

function verdictFor(
  inventory: Inventory,
  entry: Entry,
  tracking: Tracking,
  defaultBranch: string,
): Verdict {
  if (entry.path === inventory.main.path) {
    return { kind: 'skip', reason: 'the main worktree is never removed' };
  }
  if (entry.branch === defaultBranch) {
    return { kind: 'skip', reason: `'${entry.branch}' is the default branch` };
  }
  if (entry.prunable !== null) {
    return {
      kind: 'skip',
      reason:
        'registered but its directory is missing — run `git worktree prune`',
    };
  }
  if (entry.locked !== null) {
    const reason = typeof entry.locked === 'string' ? `: ${entry.locked}` : '';
    return { kind: 'skip', reason: `locked${reason}` };
  }
  // A branch tracking a local branch reports gone once that branch is deleted
  // and carries no evidence of having been merged anywhere; a branch on another
  // remote reports gone from whenever that remote was last pruned, which this
  // run did not do and so cannot date.
  if (
    tracking.upstream === null ||
    !tracking.upstream.startsWith(ORIGIN_PREFIX)
  ) {
    return {
      kind: 'skip',
      reason: `upstream '${tracking.upstream ?? 'none'}' is not an origin branch, and only origin was pruned`,
    };
  }
  return { kind: 'remove' };
}

/**
 * Remove the worktrees whose pull request has been merged and its remote branch
 * deleted, then fast-forward the main worktree's default branch.
 *
 * `branch -D` is unavoidable: `-d` refuses a squash-merged branch, which is
 * exactly the case here. Once the upstream ref is gone there is no way left to
 * tell a merged commit from an unpushed one, so a clean working tree is the
 * only additional gate, and every deletion prints the tip it discarded.
 *
 * Unlike `add`, this does not roll back. It destroys pre-existing state rather
 * than its own, so nothing it removes can be restored; instead it announces
 * each action before taking it and stops at the first failure. `--dry-run`
 * (alias `-n`) reports the same decisions without acting on any of them.
 */
export async function tidyWorktrees(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
): Promise<void> {
  const dryRun = parseTokens(tokens);

  // Both probes run before the fetch so a bare repository or a repository with
  // no origin fails without a network round-trip.
  const inventory = await readInventory(run);
  const defaultBranch = await resolveDefaultBranch(run);

  // The prune runs even under --dry-run: it is what makes a deleted upstream
  // visible, and a preview computed from stale remote-tracking refs would
  // answer for a different repository than the real run.
  await runStep(run, ['fetch', '--prune', 'origin']);

  // Read after the prune, or `gone` answers for the state before it.
  const tracking = await readTracking(run);
  const decisions = classify(inventory, tracking, defaultBranch);

  const targets: Entry[] = [];
  const skipped: string[] = [];
  for (const { entry, verdict } of decisions) {
    const name = displayName(inventory.layout, entry.path);
    if (verdict.kind === 'skip') {
      skipped.push(`  ${name}  ${verdict.reason}`);
      continue;
    }
    if (await isCurrentDirectory(entry)) {
      skipped.push(
        `  ${name}  you are standing in it — run this from another worktree`,
      );
      continue;
    }
    const dirty = await readDirtyCount(run, entry.path);
    if (dirty === null) {
      skipped.push(`  ${name}  its working tree could not be read`);
      continue;
    }
    if (dirty > 0) {
      skipped.push(`  ${name}  ${dirty} uncommitted change(s)`);
      continue;
    }
    targets.push(entry);
  }

  for (const entry of targets) {
    const name = displayName(inventory.layout, entry.path);
    const branch = entry.branch as string;
    const tip = entry.head === null ? '' : ` (tip ${entry.head.slice(0, 7)})`;
    if (dryRun) {
      write(`Would remove ${name} and delete ${branch}${tip}.\n`);
      continue;
    }
    write(`Removing ${name} and deleting ${branch}...\n`);
    await runStep(run, ['worktree', 'remove', entry.path]);
    await runStep(run, ['branch', '-D', '--', branch]);
    // The tip is already in the inventory, so the one handle that can undo a
    // -D on evidence this circumstantial costs nothing to print.
    write(
      entry.head === null
        ? `Deleted ${branch}.\n`
        : `Deleted ${branch} (was ${entry.head.slice(0, 7)} — restore with \`git branch ${branch} ${entry.head}\`).\n`,
    );
  }

  if (skipped.length > 0) write(`Skipped:\n${skipped.join('\n')}\n`);
  write(
    `${dryRun ? 'Would remove' : 'Removed'} ${targets.length} worktree(s), skipped ${skipped.length}.\n`,
  );

  await updateDefaultBranch(
    run,
    inventory,
    tracking,
    defaultBranch,
    dryRun,
    write,
  );
}

/** Whether the run is a preview. The only argument tidy accepts. */
function parseTokens(tokens: readonly string[]): boolean {
  let dryRun = false;
  for (const token of tokens) {
    if (token === '--dry-run' || token === '-n') {
      dryRun = true;
      continue;
    }
    throw new CommandLineError(
      `Unexpected argument '${token}': tidy takes no arguments other than --dry-run.`,
    );
  }
  return dryRun;
}

/**
 * Fast-forward the main worktree's default branch. Every precondition but the
 * dirty check is already in hand, and none of them is a failure: tidy declines
 * to update rather than refusing to have run. It never checks out — a cleanup
 * command moving the main worktree off its branch is a surprise with no undo.
 */
async function updateDefaultBranch(
  run: CommandRunner,
  inventory: Inventory,
  tracking: ReadonlyMap<string, Tracking>,
  defaultBranch: string,
  dryRun: boolean,
  write: (message: string) => void,
): Promise<void> {
  const decline = (reason: string) => {
    write(`Left '${defaultBranch}' as it is: ${reason}.\n`);
  };

  if (inventory.main.branch !== defaultBranch) {
    decline(
      `the main worktree is on '${inventory.main.branch ?? 'a detached HEAD'}', not '${defaultBranch}'`,
    );
    return;
  }
  const state = tracking.get(defaultBranch);
  if (state === undefined || state.upstream === null) {
    decline(`'${defaultBranch}' has no upstream`);
    return;
  }
  // The counts below are measured against the configured upstream while the
  // merge names origin's ref, so a default branch tracking anything else would
  // be judged against one ref and moved by another.
  const expected = `${ORIGIN_PREFIX}${defaultBranch}`;
  if (state.upstream !== expected) {
    decline(`'${defaultBranch}' tracks '${state.upstream}', not '${expected}'`);
    return;
  }
  if (state.ahead > 0) {
    decline(`'${defaultBranch}' has ${state.ahead} unpushed commit(s)`);
    return;
  }
  if (state.behind === 0) {
    decline(`'${defaultBranch}' is already up to date`);
    return;
  }
  const dirty = await readDirtyCount(run, inventory.main.path);
  if (dirty === null) {
    decline('the main worktree could not be read');
    return;
  }
  if (dirty > 0) {
    decline(`the main worktree has ${dirty} uncommitted change(s)`);
    return;
  }

  if (dryRun) {
    write(
      `Would fast-forward '${defaultBranch}' by ${state.behind} commit(s).\n`,
    );
    return;
  }

  write(`Updating ${defaultBranch}...\n`);
  // `merge --ff-only` rather than `pull`: the fetch above already ran, and this
  // cannot manufacture a merge commit on the default branch.
  await runStep(run, [
    '-C',
    inventory.main.path,
    'merge',
    '--ff-only',
    `origin/${defaultBranch}`,
  ]);
}

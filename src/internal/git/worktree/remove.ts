import { CommandLineError } from '../../../errors';
import { runStep } from '../../../git/run';
import type { CommandRunner } from '../../../host/command';
import {
  ambiguousMessage,
  type Entry,
  findEntries,
  type Inventory,
  isCurrentDirectory,
  knownNames,
  lockedMessage,
  readInventory,
} from './inventory';
import { displayName } from './layout';

interface Request {
  readonly tokens: readonly string[];
  readonly force: boolean;
}

/**
 * Remove worktrees named by branch, suffix, basename, or path. Branches are
 * left in place — a worktree and its branch have separate lifetimes — and the
 * ones left behind are named at the end.
 */
export async function removeWorktrees(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
): Promise<void> {
  const request = parseTokens(tokens);
  const inventory = await readInventory(run);
  const targets = await resolveAll(inventory, request.tokens);

  for (const entry of targets) {
    const name = displayName(inventory.layout, entry.path);
    if (entry.path === inventory.main.path) {
      throw new CommandLineError('Cannot remove the main worktree.');
    }
    // git reports a bare "validation failed" for a registered-but-missing
    // worktree, which names neither the cause nor the fix.
    if (entry.prunable !== null) {
      throw new CommandLineError(
        `'${name}' is registered but its directory is missing. Run \`git worktree prune\` instead.`,
      );
    }
    if (entry.locked !== null) {
      throw new CommandLineError(lockedMessage(inventory, entry));
    }
    if (await isCurrentDirectory(entry)) {
      throw new CommandLineError(
        'Cannot remove the worktree you are in. Run this from another worktree.',
      );
    }
  }

  // A dirty worktree is deliberately not pre-checked: git's own message already
  // names the condition and the flag that overrides it, and checking would cost
  // a status spawn per worktree.
  const force = request.force ? ['--force'] : [];
  for (const entry of targets) {
    write(`Removing ${displayName(inventory.layout, entry.path)}...\n`);
    await runStep(run, ['worktree', 'remove', ...force, entry.path]);
  }

  write(summary(targets));
}

function parseTokens(tokens: readonly string[]): Request {
  const names: string[] = [];
  let force = false;
  for (const token of tokens) {
    if (token === '--force' || token === '-f') {
      force = true;
      continue;
    }
    if (token === '--') {
      throw new CommandLineError(
        "'--' is not supported; every argument names a worktree.",
      );
    }
    if (token.startsWith('-')) {
      throw new CommandLineError(`Unknown option '${token}'.`);
    }
    if (!names.includes(token)) names.push(token);
  }
  if (names.length === 0) {
    throw new CommandLineError('At least one worktree is required.');
  }
  return { tokens: names, force };
}

async function resolveAll(
  inventory: Inventory,
  tokens: readonly string[],
): Promise<Entry[]> {
  const resolved: Entry[] = [];
  const unmatched: string[] = [];

  for (const token of tokens) {
    const matches = await findEntries(inventory, token);
    const first = matches[0];
    if (!first) {
      unmatched.push(token);
      continue;
    }
    if (matches.length > 1) {
      throw new CommandLineError(ambiguousMessage(inventory, token, matches));
    }
    // Distinct tokens can name the same worktree — a branch and its suffix, for
    // instance — and removing it twice would fail on the second pass.
    if (!resolved.some((entry) => entry.path === first.path)) {
      resolved.push(first);
    }
  }

  if (unmatched.length > 0) {
    throw new CommandLineError(
      `No worktree matches: ${unmatched.join(', ')}. Known worktrees: ${knownNames(inventory)}.`,
    );
  }
  return resolved;
}

function summary(removed: readonly Entry[]): string {
  const count = `Removed ${removed.length} worktree(s).`;
  const branches = removed
    .map((entry) => entry.branch)
    .filter((branch): branch is string => branch !== null);
  if (branches.length === 0) return `${count}\n`;
  return `${count} Branches ${branches.join(', ')} still exist; delete them with \`git branch -d ${branches.join(' ')}\`.\n`;
}

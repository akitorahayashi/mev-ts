import { join } from 'node:path';
import { CommandLineError } from '../../../errors';
import { runStep } from '../../../git/run';
import { lstatIfPresent } from '../../../host/absence';
import type { CommandRunner } from '../../../host/command';
import {
  isCurrentDirectory,
  lockedMessage,
  readInventory,
  resolveEntry,
} from './inventory';
import {
  directoryName,
  displayName,
  exceedsNameLimit,
  NAME_MAX_BYTES,
  pathFor,
  suffixProblem,
} from './layout';

/**
 * Rename a worktree's directory to `<repo>-<name>`. The branch is left alone:
 * a worktree that no longer matches the naming rule is still resolved by
 * inventory lookup, so the two need not stay in step.
 */
export async function moveWorktree(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
): Promise<void> {
  const [token, suffix, ...rest] = tokens;
  if (token === undefined || suffix === undefined || rest.length > 0) {
    throw new CommandLineError(
      'move requires exactly two arguments: the worktree and its new name.',
    );
  }
  const problem = suffixProblem(suffix);
  if (problem !== null) {
    throw new CommandLineError(`Invalid name '${suffix}': ${problem}.`);
  }

  const inventory = await readInventory(run);
  const entry = await resolveEntry(inventory, token);
  const source = displayName(inventory.layout, entry.path);

  // The layout derives from the main worktree, so moving it would move every
  // other worktree's name out from under it. Nothing here needs that.
  if (entry.path === inventory.main.path) {
    throw new CommandLineError('Cannot move the main worktree.');
  }
  if (entry.prunable !== null) {
    throw new CommandLineError(
      `'${source}' is registered but its directory is missing. Run \`git worktree prune\` instead.`,
    );
  }
  if (entry.locked !== null) {
    throw new CommandLineError(lockedMessage(inventory, entry));
  }
  // Documented git behavior: a worktree containing submodules cannot be moved.
  // Left to git it reports a bare validation failure with no cause.
  if ((await lstatIfPresent(join(entry.path, '.gitmodules'))) !== null) {
    throw new CommandLineError(
      `'${source}' contains submodules and cannot be moved.`,
    );
  }
  if (await isCurrentDirectory(entry)) {
    throw new CommandLineError(
      'Cannot move the worktree you are in. Run this from another worktree.',
    );
  }

  const name = directoryName(inventory.layout, suffix);
  if (exceedsNameLimit(name)) {
    throw new CommandLineError(
      `Invalid name '${suffix}': the directory name would exceed ${NAME_MAX_BYTES} bytes.`,
    );
  }

  const destination = pathFor(inventory.layout, suffix);
  if (destination === entry.path) {
    throw new CommandLineError(`'${name}' is already the current location.`);
  }
  const occupant = inventory.entries.find(
    (other) => other.path === destination,
  );
  if (occupant) {
    throw new CommandLineError(
      occupant.prunable !== null
        ? `'${name}' is registered to a worktree whose directory is missing. Run \`git worktree prune\` first.`
        : `'${name}' is already a worktree.`,
    );
  }
  if ((await lstatIfPresent(destination)) !== null) {
    throw new CommandLineError(`'${name}' already exists.`);
  }

  write(`Moving ${source} to ${name}...\n`);
  // The resolved path, never the token: git applies its own `<worktree>`
  // matching to an argument, which can select a different worktree than the one
  // validated above.
  await runStep(run, ['worktree', 'move', entry.path, destination]);
}

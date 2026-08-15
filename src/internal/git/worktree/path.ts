import { CommandLineError } from '../../../errors';
import type { CommandRunner } from '../../../host/command';
import { readInventory, resolveEntry } from './inventory';

/**
 * Write one worktree path and nothing else, so a shell function can `cd` into
 * the result of a command substitution. The single write is the contract: any
 * progress line added here would be captured as part of the path.
 *
 * With no token this answers the main worktree, which is what makes an
 * argument-less `wcd` a way back to it. The path written is the one git
 * recorded, matching what `list` displays and what `move` and `remove` pass
 * back to git.
 */
export async function printWorktreePath(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
): Promise<void> {
  if (tokens.length > 1) {
    throw new CommandLineError(
      'path takes at most one argument: the worktree.',
    );
  }

  const inventory = await readInventory(run);
  const token = tokens[0];
  const entry =
    token === undefined ? inventory.main : await resolveEntry(inventory, token);
  write(`${entry.path}\n`);
}

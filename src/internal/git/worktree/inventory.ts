import { basename, resolve as resolvePath } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../../errors';
import { runCapture } from '../../../git/run';
import { realpathIfPresent } from '../../../host/absence';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';
import { displayName, type Layout, layoutFor, nfc, suffixOf } from './layout';

export interface Entry {
  readonly path: string;
  readonly branch: string | null;
  readonly head: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: string | true | null;
  readonly prunable: string | true | null;
}

export interface Inventory {
  readonly entries: readonly Entry[];
  readonly main: Entry;
  readonly layout: Layout;
}

// `-z` (git 2.36) exists because the newline-delimited porcelain c-quotes paths
// and lock reasons unreliably; without it a path containing a newline splits
// into two bogus attributes.
const LIST_ARGS = ['worktree', 'list', '--porcelain', '-z'];

const LIST_LABEL = `git ${LIST_ARGS.join(' ')}`;

const HEADS_PREFIX = 'refs/heads/';

function toEntry(attributes: readonly string[]): Entry {
  const record = new Map<string, string | true>();
  for (const attribute of attributes) {
    // Split at the first space only: paths and lock reasons contain spaces, and
    // a boolean attribute is a bare label with no value at all.
    const space = attribute.indexOf(' ');
    if (space === -1) record.set(attribute, true);
    else record.set(attribute.slice(0, space), attribute.slice(space + 1));
  }

  const path = record.get('worktree');
  if (typeof path !== 'string') {
    throw new ProvisioningError(
      `Unexpected \`${LIST_LABEL}\` output: a record has no worktree path.`,
    );
  }
  const branch = record.get('branch');
  const head = record.get('HEAD');
  return {
    path,
    branch:
      typeof branch === 'string' && branch.startsWith(HEADS_PREFIX)
        ? branch.slice(HEADS_PREFIX.length)
        : null,
    head: typeof head === 'string' ? head : null,
    bare: record.has('bare'),
    detached: record.has('detached'),
    locked: record.get('locked') ?? null,
    prunable: record.get('prunable') ?? null,
  };
}

/**
 * Records are separated by an empty attribute, so the record terminator and the
 * separator together read as a doubled NUL. Only the leading `worktree`
 * attribute is guaranteed by git — `bare` records carry no HEAD and detached
 * ones no branch — so nothing may be addressed by position.
 */
export function parseInventory(stdout: string): Entry[] {
  return stdout
    .split('\0\0')
    .filter((record) => record !== '')
    .map((record) =>
      toEntry(record.split('\0').filter((attribute) => attribute !== '')),
    );
}

export async function readInventory(run: CommandRunner): Promise<Inventory> {
  // runCapture does not throw on a non-zero exit; without this check running
  // outside a repository would parse as zero worktrees and the layout would be
  // derived from nothing.
  const result = await runCapture(run, LIST_ARGS);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`${LIST_LABEL} failed`, result),
    );
  }

  const entries = parseInventory(result.stdout);
  const main = entries[0];
  if (!main) {
    throw new ProvisioningError(
      `Unexpected \`${LIST_LABEL}\` output: no worktree records.`,
    );
  }
  if (main.bare) {
    throw new ProvisioningError('Bare repositories are not supported.');
  }
  return { entries, main, layout: layoutFor(main.path) };
}

export function knownNames(inventory: Inventory): string {
  return inventory.entries
    .map((entry) => displayName(inventory.layout, entry.path))
    .join(', ');
}

async function realpathOrSelf(path: string): Promise<string> {
  // A prunable worktree has no directory left to resolve; its recorded path is
  // still the identity git will match on.
  return (await realpathIfPresent(path)) ?? path;
}

async function matchByPath(
  inventory: Inventory,
  token: string,
): Promise<Entry | null> {
  const wanted = await realpathIfPresent(resolvePath(process.cwd(), token));
  if (wanted === null) return null;
  const resolved = await Promise.all(
    inventory.entries.map((entry) => realpathOrSelf(entry.path)),
  );
  const index = resolved.indexOf(wanted);
  return index === -1 ? null : (inventory.entries[index] as Entry);
}

/**
 * The worktrees a token names. A token is an existing path, a branch name, a
 * `<suffix>`, or a directory basename; the display form used by `list` is
 * always among them, so anything shown can be passed straight back.
 *
 * An exact path settles the match outright. Name arms can legitimately collide
 * once a worktree has been moved — one worktree's branch can equal another's
 * suffix — and a path is the only identifier guaranteed to be unique.
 *
 * Returning the candidates rather than throwing lets `remove` report every
 * unmatched token at once instead of one per run.
 */
export async function findEntries(
  inventory: Inventory,
  token: string,
): Promise<Entry[]> {
  const exact = await matchByPath(inventory, token);
  if (exact) return [exact];

  const wanted = nfc(token);
  return inventory.entries.filter(
    (entry) =>
      (entry.branch !== null && nfc(entry.branch) === wanted) ||
      nfc(basename(entry.path)) === wanted ||
      suffixOf(inventory.layout, entry.path) === wanted,
  );
}

export function ambiguousMessage(
  inventory: Inventory,
  token: string,
  matches: readonly Entry[],
): string {
  const names = matches
    .map((entry) => displayName(inventory.layout, entry.path))
    .join(', ');
  return `'${token}' matches more than one worktree: ${names}. Use the path to disambiguate.`;
}

export async function resolveEntry(
  inventory: Inventory,
  token: string,
): Promise<Entry> {
  const matches = await findEntries(inventory, token);
  const first = matches[0];
  if (!first) {
    throw new CommandLineError(
      `No worktree matches '${token}'. Known worktrees: ${knownNames(inventory)}.`,
    );
  }
  if (matches.length > 1) {
    throw new CommandLineError(ambiguousMessage(inventory, token, matches));
  }
  return first;
}

export function lockedMessage(inventory: Inventory, entry: Entry): string {
  const reason = typeof entry.locked === 'string' ? `: ${entry.locked}` : '';
  const name = displayName(inventory.layout, entry.path);
  return `'${name}' is locked${reason}. Run \`git worktree unlock ${entry.path}\` first.`;
}

/**
 * Whether the process is standing in this worktree. Removing or moving it would
 * leave the caller's shell in a deleted or stale directory.
 */
export async function isCurrentDirectory(entry: Entry): Promise<boolean> {
  const here = await realpathIfPresent(process.cwd());
  if (here === null) return false;
  const there = await realpathOrSelf(entry.path);
  return here === there || here.startsWith(`${there}/`);
}

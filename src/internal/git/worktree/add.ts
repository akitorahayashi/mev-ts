import {
  CommandLineError,
  errorMessage,
  ProvisioningError,
} from '../../../errors';
import { runCapture, runStep } from '../../../git/run';
import { lstatIfPresent } from '../../../host/absence';
import { throwWithCleanupError } from '../../../host/cleanup-error';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';
import { findDefaultBranch } from '../default-branch';
import { carryInto, readCarryPaths } from './carry';
import { type Inventory, readInventory } from './inventory';
import {
  branchNameProblem,
  directoryName,
  displayName,
  exceedsNameLimit,
  NAME_MAX_BYTES,
  nfc,
  pathFor,
  slug,
} from './layout';

const HEADS_PREFIX = 'refs/heads/';
const REMOTES_PREFIX = 'refs/remotes/';

const REF_ARGS = [
  'for-each-ref',
  '--format=%(refname)',
  HEADS_PREFIX,
  REMOTES_PREFIX,
];

interface Refs {
  readonly local: ReadonlySet<string>;
  /** Branch name to the remotes carrying it. */
  readonly tracked: ReadonlyMap<string, readonly string[]>;
}

interface Plan {
  readonly branch: string;
  readonly path: string;
  readonly name: string;
  readonly args: readonly string[];
  readonly note: string;
  /** Whether the branch itself is being created, and so is ours to undo. */
  readonly createdBranch: boolean;
  /** Whether the new branch starts at the invoking worktree's HEAD. */
  readonly fromHead: boolean;
}

/**
 * Create a worktree per branch as a sibling of the main worktree. Existing
 * branches are checked out, branches that exist only on a remote are tracked,
 * and the rest are created. The whole request is validated before any git state
 * changes, and a failure part-way through removes what was already created.
 */
export async function addWorktrees(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
  warn: (message: string) => void = () => {},
): Promise<void> {
  const branches = parseTokens(tokens);
  const inventory = await readInventory(run);
  const refs = await readRefs(run);
  const plans = await buildPlans(inventory, refs, branches);

  // Nothing branches from HEAD when every plan checks out or tracks, and the
  // probe below is worth no spawn in that case.
  if (plans.some((plan) => plan.fromHead)) {
    await warnIfBehindDefault(run, warn);
  }

  const created: Plan[] = [];
  try {
    for (const plan of plans) {
      write(`Adding ${plan.name} for '${plan.branch}' (${plan.note})...\n`);
      await runStep(run, plan.args);
      created.push(plan);
    }
  } catch (error) {
    if (created.length === 0) throw error;
    write(`Rolling back ${created.length} worktree(s)...\n`);
    try {
      await rollback(run, created);
    } catch (cleanupError) {
      throwWithCleanupError(
        error,
        cleanupError,
        'Failed to roll back the worktrees created before the failure.',
      );
    }
    throw error;
  }

  await carryIgnored(run, inventory, plans, write, warn);
}

/**
 * Bring the main worktree's ignored files along. Always from the main worktree,
 * not from wherever the command was invoked, matching how the layout itself is
 * derived — otherwise the same command would produce different worktrees
 * depending on which directory it was run from.
 *
 * Run after the rollback-protected section and never allowed to fail the
 * command: the worktrees exist and are usable, and undoing them over a copy
 * would discard more than it repairs.
 */
async function carryIgnored(
  run: CommandRunner,
  inventory: Inventory,
  plans: readonly Plan[],
  write: (message: string) => void,
  warn: (message: string) => void,
): Promise<void> {
  try {
    const paths = await readCarryPaths(run, inventory.main.path, warn);
    if (paths.length === 0) return;

    let plain = false;
    for (const plan of plans) {
      const report = await carryInto(
        run,
        inventory.main.path,
        plan.path,
        paths,
        warn,
      );
      plain ||= report.copiedWithoutCloning;
      write(`Carried ${report.carried} ignored path(s) into ${plan.name}.\n`);
    }
    if (plain) {
      warn(
        'Some paths were copied rather than cloned; this filesystem does not support APFS cloning, so they consume their full size.\n',
      );
    }
  } catch (error) {
    warn(`Could not carry the ignored files: ${errorMessage(error)}\n`);
  }
}

function parseTokens(tokens: readonly string[]): string[] {
  const branches: string[] = [];
  for (const token of tokens) {
    if (token === '--') {
      throw new CommandLineError(
        "'--' is not supported; every argument is a branch name.",
      );
    }
    const problem = branchNameProblem(token);
    if (problem !== null) {
      throw new CommandLineError(`Invalid branch name '${token}': ${problem}.`);
    }
    if (!branches.includes(token)) branches.push(token);
  }
  if (branches.length === 0) {
    throw new CommandLineError('At least one branch is required.');
  }
  return branches;
}

async function readRefs(run: CommandRunner): Promise<Refs> {
  const result = await runCapture(run, REF_ARGS);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git for-each-ref failed', result),
    );
  }

  const local = new Set<string>();
  const tracked = new Map<string, string[]>();
  for (const ref of result.stdout.split('\n').filter((line) => line !== '')) {
    if (ref.startsWith(HEADS_PREFIX)) {
      local.add(ref.slice(HEADS_PREFIX.length));
      continue;
    }
    if (!ref.startsWith(REMOTES_PREFIX)) continue;
    const rest = ref.slice(REMOTES_PREFIX.length);
    // A remote name cannot contain a slash, so the first component is the
    // remote and everything after it is the branch.
    const slash = rest.indexOf('/');
    if (slash === -1) continue;
    const name = rest.slice(slash + 1);
    // refs/remotes/<remote>/HEAD is the remote's default-branch symref.
    if (name === 'HEAD') continue;
    const remote = rest.slice(0, slash);
    const remotes = tracked.get(name);
    if (remotes) remotes.push(remote);
    else tracked.set(name, [remote]);
  }
  return { local, tracked };
}

async function buildPlans(
  inventory: Inventory,
  refs: Refs,
  branches: readonly string[],
): Promise<Plan[]> {
  const registered = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const claimed = new Map<string, string>();
  const plans: Plan[] = [];

  for (const branch of branches) {
    const suffix = slug(branch);
    const name = directoryName(inventory.layout, suffix);
    if (exceedsNameLimit(name)) {
      throw new CommandLineError(
        `Branch '${branch}' derives a directory name longer than ${NAME_MAX_BYTES} bytes: '${name}'.`,
      );
    }

    // APFS is case-insensitive, so two branches differing only in case derive
    // distinct strings but collide on disk — which would surface only after the
    // first worktree had already been created.
    const key = nfc(name).toLowerCase();
    const taken = claimed.get(key);
    if (taken !== undefined) {
      throw new CommandLineError(
        `Branches '${taken}' and '${branch}' both map to '${name}'.`,
      );
    }
    claimed.set(key, branch);

    const path = pathFor(inventory.layout, suffix);
    const existing = registered.get(path);
    if (existing) {
      if (existing.prunable !== null) {
        throw new CommandLineError(
          `'${name}' is registered to a worktree whose directory is missing. Run \`git worktree prune\` first.`,
        );
      }
      throw new CommandLineError(
        existing.branch === null
          ? `'${name}' is already a worktree.`
          : `'${name}' is already the worktree for branch '${existing.branch}'.`,
      );
    }
    if ((await lstatIfPresent(path)) !== null) {
      throw new CommandLineError(`'${name}' already exists.`);
    }

    const checkedOut = inventory.entries.find(
      (entry) => entry.branch !== null && nfc(entry.branch) === nfc(branch),
    );
    if (checkedOut) {
      throw new CommandLineError(
        `Branch '${branch}' is already checked out at '${displayName(inventory.layout, checkedOut.path)}'.`,
      );
    }

    plans.push(planFor(refs, branch, path, name));
  }
  return plans;
}

/**
 * Passing `-b` disables git's own remote-tracking DWIM, so a branch that exists
 * only on a remote would be created empty at HEAD instead of at the remote tip
 * — leaving a push to be rejected as non-fast-forward. The three cases are
 * therefore separated here rather than left to git.
 */
function planFor(refs: Refs, branch: string, path: string, name: string): Plan {
  if (refs.local.has(branch)) {
    return {
      branch,
      path,
      name,
      args: ['worktree', 'add', path, branch],
      note: 'existing branch',
      createdBranch: false,
      fromHead: false,
    };
  }

  const remotes = refs.tracked.get(branch) ?? [];
  if (remotes.length > 1) {
    throw new CommandLineError(
      `Branch '${branch}' exists on more than one remote: ${remotes.join(', ')}. Create the local branch first.`,
    );
  }
  const remote = remotes[0];
  if (remote !== undefined) {
    return {
      branch,
      path,
      name,
      args: [
        'worktree',
        'add',
        '--track',
        '-b',
        branch,
        path,
        `${remote}/${branch}`,
      ],
      note: `tracking ${remote}/${branch}`,
      createdBranch: true,
      fromHead: false,
    };
  }

  return {
    branch,
    path,
    name,
    args: ['worktree', 'add', '-b', branch, path],
    note: 'new branch',
    createdBranch: true,
    fromHead: true,
  };
}

/**
 * A branch created from HEAD inherits whatever HEAD is, and the main worktree
 * is routinely left behind after a pull request merges elsewhere.
 *
 * The comparison is against the local remote-tracking ref, so it only sees as
 * far as the last fetch: a machine that has not fetched in a week can be far
 * behind and still draw no warning. `add` deliberately does not fetch — a
 * network round-trip on every worktree creation is the worse trade.
 */
async function warnIfBehindDefault(
  run: CommandRunner,
  warn: (message: string) => void,
): Promise<void> {
  const branch = await findDefaultBranch(run);
  if (branch === null) return;

  const args = ['rev-list', '--count', `HEAD..origin/${branch}`];
  const result = await runCapture(run, args);
  if (result.code !== 0) {
    // The ref is the one origin/HEAD itself names, so it exists; a failure here
    // is not the absent-origin case findDefaultBranch already answered for.
    throw new ProvisioningError(
      formatCommandFailure(`git ${args.join(' ')} failed`, result),
    );
  }

  const behind = Number(result.stdout.trim());
  if (!Number.isFinite(behind) || behind === 0) return;
  warn(
    `HEAD is ${behind} commit(s) behind origin/${branch}; a branch created from it starts behind. Fetch and update before branching if that is not intended.\n`,
  );
}

async function rollback(
  run: CommandRunner,
  created: readonly Plan[],
): Promise<void> {
  for (const plan of [...created].reverse()) {
    await runStep(run, ['worktree', 'remove', plan.path]);
    // The branch was created moments ago at HEAD or at a remote tip and has
    // been checked out into an untouched worktree, so -D discards no work.
    if (plan.createdBranch) {
      await runStep(run, ['branch', '-D', '--', plan.branch]);
    }
  }
}

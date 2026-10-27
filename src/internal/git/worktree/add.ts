import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
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
import { checkSharedTmp, linkSharedTmp } from './shared-tmp';

const HEADS_PREFIX = 'refs/heads/';
const REMOTES_PREFIX = 'refs/remotes/';

const REF_ARGS = [
  'for-each-ref',
  '--format=%(refname)',
  HEADS_PREFIX,
  REMOTES_PREFIX,
];

const FROM = '--from';

interface Request {
  readonly branches: readonly string[];
  /** The explicit start point for new branches, or null for the default. */
  readonly from: string | null;
}

interface Refs {
  readonly local: ReadonlySet<string>;
  /** Branch name to the remotes carrying it. */
  readonly tracked: ReadonlyMap<string, readonly string[]>;
}

interface Placement {
  readonly branch: string;
  readonly path: string;
  readonly name: string;
}

interface Plan extends Placement {
  readonly args: readonly string[];
  readonly note: string;
  /** Whether the branch itself is being created, and so is ours to undo. */
  readonly createdBranch: boolean;
  /** The tree the worktree will hold. */
  readonly treeish: string;
}

/**
 * Create a worktree per branch as a sibling of the main worktree. Existing
 * branches are checked out, branches that exist only on a remote are tracked,
 * and the rest are created from the freshly fetched default branch or from
 * `--from`. The whole request is validated before any git state changes, and a
 * failure part-way through removes what was already created.
 */
export async function addWorktrees(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
  warn: (message: string) => void = () => {},
): Promise<void> {
  const request = parseTokens(tokens);
  const inventory = await readInventory(run);
  const placements = await placeAll(inventory, request.branches);

  const remotes = await readRemotes(run);
  let refs = await readRefs(run, remotes);
  // Branches already local need nothing from the network, so checking them
  // out stays possible offline.
  if (
    request.from === null &&
    remotes.includes('origin') &&
    placements.some((placement) => !refs.local.has(placement.branch))
  ) {
    await fetchOrigin(run, write);
    refs = await readRefs(run, remotes);
  }

  const fresh = placements
    .filter((placement) => isFresh(refs, placement.branch))
    .map((placement) => placement.branch);
  const start = await resolveStart(run, request.from, fresh);
  const plans = placements.map((placement) => planFor(refs, placement, start));

  await checkSharedTmp(run, inventory.main.path, plans);

  const created: Plan[] = [];
  try {
    const commonDir = await gitDirOf(
      run,
      inventory.main.path,
      '--git-common-dir',
    );
    for (const plan of plans) {
      write(`Adding ${plan.name} for '${plan.branch}' (${plan.note})...\n`);
      await runStep(run, plan.args);
      created.push(plan);
      await populate(run, commonDir, plan.path);
    }
    await linkSharedTmp(
      run,
      inventory.main.path,
      plans.map((plan) => plan.path),
    );
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
    const paths = await readCarryPaths(run, inventory.main.path);
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

function parseTokens(tokens: readonly string[]): Request {
  const branches: string[] = [];
  let from: string | null = null;
  const setFrom = (value: string | undefined) => {
    if (value === undefined || value === '' || value.startsWith('-')) {
      throw new CommandLineError(`${FROM} requires a ref.`);
    }
    if (from !== null) {
      throw new CommandLineError(`${FROM} may be given only once.`);
    }
    from = value;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    if (token === '--') {
      throw new CommandLineError(
        "'--' is not supported; every argument other than --from is a branch name.",
      );
    }
    if (token === FROM) {
      index += 1;
      setFrom(tokens[index]);
      continue;
    }
    if (token.startsWith(`${FROM}=`)) {
      setFrom(token.slice(FROM.length + 1));
      continue;
    }
    if (token.startsWith('-')) {
      throw new CommandLineError(`Unknown option '${token}'.`);
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
  return { branches, from };
}

/**
 * Remote names may contain a slash — `git remote add team/upstream` is
 * accepted — so `refs/remotes/<remote>/<branch>` cannot be split at its first
 * slash. Matching the configured names longest first is the only boundary.
 */
async function readRemotes(run: CommandRunner): Promise<string[]> {
  const result = await runCapture(run, ['remote']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git remote failed', result),
    );
  }
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .sort((left, right) => right.length - left.length);
}

async function readRefs(
  run: CommandRunner,
  remotes: readonly string[],
): Promise<Refs> {
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
    // A ref left behind by a removed remote matches no configured name.
    const remote = remotes.find((candidate) =>
      rest.startsWith(`${candidate}/`),
    );
    if (remote === undefined) continue;
    const name = rest.slice(remote.length + 1);
    // refs/remotes/<remote>/HEAD is the remote's default-branch symref.
    if (name === 'HEAD') continue;
    const carriers = tracked.get(name);
    if (carriers) carriers.push(remote);
    else tracked.set(name, [remote]);
  }
  return { local, tracked };
}

async function fetchOrigin(
  run: CommandRunner,
  write: (message: string) => void,
): Promise<void> {
  write('Fetching origin...\n');
  try {
    await runStep(run, ['fetch', 'origin']);
  } catch (error) {
    throw new ProvisioningError(
      `${errorMessage(error)} Pass ${FROM} <ref> to create new branches from a local ref without fetching.`,
    );
  }
}

async function placeAll(
  inventory: Inventory,
  branches: readonly string[],
): Promise<Placement[]> {
  const registered = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const claimed = new Map<string, string>();
  const placements: Placement[] = [];

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

    placements.push({ branch, path, name });
  }
  return placements;
}

function isFresh(refs: Refs, branch: string): boolean {
  return !refs.local.has(branch) && !refs.tracked.has(branch);
}

/**
 * New branches start from the default branch as origin has it, never from the
 * invoking worktree's HEAD: that HEAD is wherever the caller happened to stand,
 * often a feature branch, and a branch cut from it silently carries that work.
 */
async function resolveStart(
  run: CommandRunner,
  from: string | null,
  fresh: readonly string[],
): Promise<string | null> {
  if (fresh.length === 0) {
    if (from !== null) {
      throw new CommandLineError(
        `${FROM} applies only to new branches, and every requested branch already exists.`,
      );
    }
    return null;
  }

  if (from !== null) {
    const verified = await runCapture(run, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${from}^{commit}`,
    ]);
    if (verified.code !== 0) {
      throw new CommandLineError(`'${from}' does not name a commit.`);
    }
    return from;
  }

  const branch = await findDefaultBranch(run);
  if (branch === null) {
    throw new CommandLineError(
      `New branch(es) ${fresh.join(', ')} need a start point and origin/HEAD is not set. Pass ${FROM} <ref>, or run \`git remote set-head origin --auto\`.`,
    );
  }
  return `origin/${branch}`;
}

/**
 * Passing `-b` disables git's own remote-tracking DWIM, so a branch that exists
 * only on a remote would be created empty instead of at the remote tip —
 * leaving a push to be rejected as non-fast-forward. The three cases are
 * therefore separated here rather than left to git.
 *
 * Every case adds with `--no-checkout`; `populate` writes the tree once the
 * worktree can reach what its filters need.
 */
function planFor(refs: Refs, placement: Placement, start: string | null): Plan {
  const { branch, path } = placement;
  if (refs.local.has(branch)) {
    return {
      ...placement,
      args: ['worktree', 'add', '--no-checkout', path, branch],
      note: 'existing branch',
      createdBranch: false,
      treeish: branch,
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
    const upstream = `${remote}/${branch}`;
    return {
      ...placement,
      args: [
        'worktree',
        'add',
        '--no-checkout',
        '--track',
        '-b',
        branch,
        path,
        upstream,
      ],
      note: `tracking ${upstream}`,
      createdBranch: true,
      treeish: upstream,
    };
  }

  if (start === null) {
    throw new ProvisioningError(
      `No start point was resolved for new branch '${branch}'.`,
    );
  }
  // `--no-track`: a branch cut from `origin/<default>` would otherwise adopt it
  // as upstream, and `git pull` there would merge the default branch.
  return {
    ...placement,
    args: [
      'worktree',
      'add',
      '--no-checkout',
      '--no-track',
      '-b',
      branch,
      path,
      start,
    ],
    note: `new branch from ${start}`,
    createdBranch: true,
    treeish: start,
  };
}

async function gitDirOf(
  run: CommandRunner,
  path: string,
  which: '--git-dir' | '--git-common-dir',
): Promise<string> {
  const result = await runCapture(run, [
    '-C',
    path,
    'rev-parse',
    '--path-format=absolute',
    which,
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`git rev-parse ${which} failed`, result),
    );
  }
  return result.stdout.trim();
}

/**
 * git-crypt looks for its keys under `rev-parse --git-dir`, which in a linked
 * worktree is the private `<common>/worktrees/<name>` rather than the common
 * directory holding them. Its smudge filter is marked required, so without the
 * link the checkout fails outright. Linking before writing the tree is why
 * worktrees are added with `--no-checkout`.
 */
async function populate(
  run: CommandRunner,
  commonDir: string,
  path: string,
): Promise<void> {
  const keys = join(commonDir, 'git-crypt');
  if ((await lstatIfPresent(keys)) !== null) {
    const destination = join(
      await gitDirOf(run, path, '--git-dir'),
      'git-crypt',
    );
    if ((await lstatIfPresent(destination)) === null) {
      await symlink(keys, destination);
    }
  }
  // Not `checkout -- .`: the index is empty after `--no-checkout`, so a
  // pathspec would match nothing.
  await runStep(run, ['-C', path, 'reset', '--hard']);
}

async function rollback(
  run: CommandRunner,
  created: readonly Plan[],
): Promise<void> {
  for (const plan of [...created].reverse()) {
    // A worktree that failed part-way through populate holds a partial tree
    // that a plain remove refuses as modified.
    await runStep(run, ['worktree', 'remove', '--force', plan.path]);
    // The branch was created moments ago at a start point or a remote tip and
    // has been checked out into an untouched worktree, so -D discards no work.
    if (plan.createdBranch) {
      await runStep(run, ['branch', '-D', '--', plan.branch]);
    }
  }
}

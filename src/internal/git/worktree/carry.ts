import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProvisioningError } from '../../../errors';
import { runCapture } from '../../../git/run';
import { lstatIfPresent } from '../../../host/absence';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';
import { runProcessCapture } from '../../../host/command-run';
import { isSharedTmpPath } from './shared-tmp';

const IGNORED_PREFIX = '!! ';

const STATUS_ARGS = ['status', '--porcelain', '--ignored', '-z'];

/**
 * Ignored paths, with whole ignored directories collapsed to one entry. The
 * collapsed form is what makes this affordable: `Pods/` is one clone rather
 * than six thousand.
 */
export function parseIgnored(stdout: string): string[] {
  return stdout
    .split('\0')
    .filter((entry) => entry.startsWith(IGNORED_PREFIX))
    .map((entry) => entry.slice(IGNORED_PREFIX.length));
}

/**
 * The paths to carry: everything ignored except the shared `.tmp`, which is
 * linked rather than copied.
 *
 * Global ignores are carried too. The global list mixes machine-local files a
 * worktree needs — `*.local` settings, agent permissions — with regenerable
 * clutter like `.DS_Store`, and no pattern tells the two apart. Cloning the
 * clutter costs metadata; leaving the local files behind breaks the worktree.
 */
export async function readCarryPaths(
  run: CommandRunner,
  source: string,
): Promise<string[]> {
  const status = await runCapture(run, ['-C', source, ...STATUS_ARGS]);
  if (status.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git status --ignored failed', status),
    );
  }
  return parseIgnored(status.stdout).filter((path) => !isSharedTmpPath(path));
}

/**
 * Copy one path, preferring an APFS clone. A clone shares blocks, so carrying a
 * dependency tree costs metadata rather than its size; `cp -c` fails outright
 * where cloning is unavailable, and the plain copy is the answer there.
 */
async function copyPath(
  run: CommandRunner,
  source: string,
  destination: string,
): Promise<{ readonly cloned: boolean; readonly failure: string | null }> {
  const cloned = await runProcessCapture(run, 'cp', [
    '-c',
    '-R',
    source,
    destination,
  ]);
  if (cloned.code === 0) return { cloned: true, failure: null };

  const copied = await runProcessCapture(run, 'cp', [
    '-R',
    source,
    destination,
  ]);
  return {
    cloned: false,
    failure:
      copied.code === 0
        ? null
        : formatCommandFailure(`cp -R ${source} failed`, copied),
  };
}

export interface CarryReport {
  readonly carried: number;
  readonly copiedWithoutCloning: boolean;
}

/**
 * Carry the source worktree's ignored paths into a new one, so the files a
 * repository deliberately keeps out of version control — credentials, fetched
 * dependencies, generated project files — are present without re-running every
 * bootstrap step.
 *
 * A failure here does not undo the worktree: it is complete and usable, and the
 * paths that did not arrive are named so they can be copied by hand.
 *
 * The carry set is read once from the source worktree and reused for every
 * destination, so it describes the source's ignore rules rather than each new
 * branch's. Branches disagree about what is ignored, which is why the
 * destination decides whether a path is carried at all.
 */
export async function carryInto(
  run: CommandRunner,
  source: string,
  destination: string,
  paths: readonly string[],
  warn: (message: string) => void,
): Promise<CarryReport> {
  let carried = 0;
  let copiedWithoutCloning = false;

  for (const reported of paths) {
    // A directory arrives from `status --ignored` with a trailing separator,
    // which would make the probe below fail with ENOTDIR instead of reporting
    // the plain file standing in its place.
    const path = reported.endsWith('/') ? reported.slice(0, -1) : reported;
    const from = join(source, path);
    const to = join(destination, path);

    // A worktree git has just created holds the checked-out tree and nothing
    // else, so anything already at the destination is content this branch
    // tracks and the source ignores only because its own branch does. Copying
    // over it would replace committed data — `cp` overwrites a file, and nests
    // the source inside an existing directory.
    if ((await lstatIfPresent(to)) !== null) {
      warn(`Left '${reported}' alone: this branch tracks it.\n`);
      continue;
    }

    const parent = dirname(to);
    if (parent !== destination) await mkdir(parent, { recursive: true });

    const { cloned, failure } = await copyPath(run, from, to);
    if (failure !== null) {
      warn(`Could not carry '${reported}': ${failure}\n`);
      continue;
    }
    if (!cloned) copiedWithoutCloning = true;
    carried += 1;
  }

  return { carried, copiedWithoutCloning };
}

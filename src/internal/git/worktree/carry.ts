import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProvisioningError } from '../../../errors';
import { runCapture } from '../../../git/run';
import { statIfPresent } from '../../../host/absence';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';
import { runProcessCapture } from '../../../host/command-run';

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

export function parseListed(stdout: string): string[] {
  return stdout.split('\0').filter((entry) => entry !== '');
}

/**
 * The paths to carry: ignored by the repository but not by the global list.
 *
 * The two sets are compared by pattern match, not by which file git credits
 * for the match. A repository that also lists `.DS_Store` in its own
 * `.gitignore` would otherwise keep it out of the global set and carry it into
 * every worktree.
 */
export function subtractGlobal(
  candidates: readonly string[],
  global: readonly string[],
): string[] {
  const excluded = new Set(global);
  return candidates.filter((path) => !excluded.has(path));
}

/**
 * Git's own resolution order for the global ignore file: `core.excludesFile`
 * when set, otherwise the XDG default that mev's `git` target deploys to.
 */
async function globalExcludesPath(run: CommandRunner): Promise<string | null> {
  const configured = await runCapture(run, [
    'config',
    '--get',
    'core.excludesFile',
  ]);
  const home = process.env['HOME'];
  const value = configured.code === 0 ? configured.stdout.trim() : '';
  if (value !== '') {
    return value.startsWith('~/') && home !== undefined
      ? join(home, value.slice(2))
      : value;
  }

  const base =
    process.env['XDG_CONFIG_HOME'] ??
    (home === undefined ? null : join(home, '.config'));
  return base === null ? null : join(base, 'git', 'ignore');
}

export async function readCarryPaths(
  run: CommandRunner,
  source: string,
  warn: (message: string) => void,
): Promise<string[]> {
  const status = await runCapture(run, ['-C', source, ...STATUS_ARGS]);
  if (status.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git status --ignored failed', status),
    );
  }
  const candidates = parseIgnored(status.stdout);
  if (candidates.length === 0) return [];

  const excludes = await globalExcludesPath(run);
  if (excludes === null || (await statIfPresent(excludes)) === null) {
    warn(
      `No global ignore file to filter by${excludes === null ? '' : ` (${excludes})`}; carrying every ignored path.\n`,
    );
    return candidates;
  }

  const global = await runCapture(run, [
    '-C',
    source,
    'ls-files',
    '-o',
    '-i',
    `--exclude-from=${excludes}`,
    '--directory',
    '-z',
  ]);
  if (global.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git ls-files failed', global),
    );
  }
  return subtractGlobal(candidates, parseListed(global.stdout));
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

  for (const path of paths) {
    const from = join(source, path);
    const to = join(destination, path);
    const parent = dirname(to);
    if (parent !== destination) await mkdir(parent, { recursive: true });

    const { cloned, failure } = await copyPath(run, from, to);
    if (failure !== null) {
      warn(`Could not carry '${path}': ${failure}\n`);
      continue;
    }
    if (!cloned) copiedWithoutCloning = true;
    carried += 1;
  }

  return { carried, copiedWithoutCloning };
}

import { ProvisioningError } from '../../../errors';
import { runCapture } from '../../../git/run';
import {
  type CommandRunner,
  formatCommandFailure,
} from '../../../host/command';
import { mapWithConcurrency } from '../../../host/task-pool';
import type { Entry } from './inventory';

export interface Tracking {
  /** The full upstream ref, or null when the branch tracks nothing. */
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  /** The configured upstream ref no longer exists. */
  readonly gone: boolean;
}

export interface EntryState {
  readonly entry: Entry;
  /** null when the working tree could not be read. */
  readonly dirty: number | null;
  /** null for a detached worktree, which has no branch to track. */
  readonly tracking: Tracking | null;
}

// `%00` expands to a NUL, and a ref name may contain neither NUL nor newline, so
// NUL-separated fields on newline-separated records need no further framing.
// `lstrip=2` rather than `%(refname:short)` for the reason branches.ts records:
// `short` abbreviates ambiguity-aware and prints `heads/foo` when a tag shares
// the branch's name. `nobracket` drops the `[...]` the porcelain-less format
// adds, so the parser strips no decoration it did not ask for.
const TRACKING_ARGS = [
  'for-each-ref',
  '--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track,nobracket)',
  'refs/heads/',
];

/**
 * `--untracked-files=normal` is pinned because a user with
 * `status.showUntrackedFiles = no` would otherwise see a clean count for a
 * worktree full of untracked work, and tidy deletes on that count.
 * `--no-optional-locks` keeps this read-only probe from rewriting each
 * worktree's index while several run at once.
 */
function statusArgs(path: string): string[] {
  return [
    '-C',
    path,
    '--no-optional-locks',
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=normal',
  ];
}

const STATUS_CONCURRENCY = 8;

function countOf(track: string, label: string): number {
  // The value reads `ahead 2`, `behind 3`, `ahead 2, behind 3`, `gone`, or is
  // empty; each count is only ever preceded by its own label.
  const match = track.match(new RegExp(`\\b${label} (\\d+)`));
  return match ? Number(match[1]) : 0;
}

export function parseTracking(stdout: string): Map<string, Tracking> {
  const tracking = new Map<string, Tracking>();
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const [branch, upstream, track] = line.split('\0');
    if (branch === undefined) continue;
    tracking.set(branch, {
      upstream: upstream === undefined || upstream === '' ? null : upstream,
      ahead: countOf(track ?? '', 'ahead'),
      behind: countOf(track ?? '', 'behind'),
      gone: (track ?? '').trim() === 'gone',
    });
  }
  return tracking;
}

/**
 * The number of changed paths. A rename or copy emits its destination and its
 * origin as two NUL-terminated fields for one change, so counting fields would
 * report it twice.
 */
export function parseDirtyCount(stdout: string): number {
  const fields = stdout.split('\0').filter((field) => field !== '');
  let count = 0;
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] as string;
    count += 1;
    const status = field.slice(0, 2);
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return count;
}

export async function readTracking(
  run: CommandRunner,
): Promise<Map<string, Tracking>> {
  const result = await runCapture(run, TRACKING_ARGS);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure('git for-each-ref failed', result),
    );
  }
  return parseTracking(result.stdout);
}

/** null when the probe could not run; an unreadable worktree is not a clean one. */
export async function readDirtyCount(
  run: CommandRunner,
  path: string,
): Promise<number | null> {
  const result = await runCapture(run, statusArgs(path));
  if (result.code !== 0) return null;
  return parseDirtyCount(result.stdout);
}

/**
 * Working-tree and tracking state per worktree, paired with its entry rather
 * than keyed by path: a lookup miss against a map would render as an absent
 * state, which is indistinguishable from a nominal one.
 */
export async function readStates(
  run: CommandRunner,
  entries: readonly Entry[],
): Promise<readonly EntryState[]> {
  const tracking = await readTracking(run);
  return mapWithConcurrency(entries, STATUS_CONCURRENCY, async (entry) => ({
    entry,
    // A prunable worktree has no directory to inspect, so the probe is skipped
    // rather than spent on a failure whose cause the marker already names.
    dirty:
      entry.prunable !== null ? null : await readDirtyCount(run, entry.path),
    tracking:
      entry.branch === null ? null : (tracking.get(entry.branch) ?? null),
  }));
}

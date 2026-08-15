import { ProvisioningError } from '../../errors';
import { runCapture } from '../../git/run';
import type { CommandRunner } from '../../host/command';

const HEAD_ARGS = ['rev-parse', '--abbrev-ref', 'origin/HEAD'];
const PREFIX = 'origin/';

/**
 * The default branch, or null when there is no origin or its HEAD is unset.
 *
 * A malformed answer still raises: a zero exit that does not name `origin/<x>`
 * is an anomaly, not an absence, and answering null there would substitute a
 * guess for a contract violation.
 */
export async function findDefaultBranch(
  run: CommandRunner,
): Promise<string | null> {
  const result = await runCapture(run, HEAD_ARGS);
  if (result.code !== 0) return null;

  const ref = result.stdout.trim();
  if (!ref.startsWith(PREFIX)) {
    throw new ProvisioningError(
      `Unexpected origin/HEAD format: "${ref}". Expected "origin/<branch>".`,
    );
  }
  return ref.slice(PREFIX.length);
}

/** The same probe for callers that cannot proceed without an answer. */
export async function resolveDefaultBranch(
  run: CommandRunner,
): Promise<string> {
  const branch = await findDefaultBranch(run);
  if (branch === null) {
    throw new ProvisioningError(
      'Unable to resolve the default branch: origin/HEAD is not set. Run `git remote set-head origin --auto` to fix this.',
    );
  }
  return branch;
}

import { ProvisioningError } from '../errors';
import { type CommandRunner, formatCommandFailure } from '../host/command';
import { runCapture } from './run';

/**
 * Whether cwd is inside a git repository (worktree, .git-file checkout, or
 * bare). Only the documented not-a-repository fatal maps to false — the
 * stderr match is stable because captures pin LC_ALL=C. Other 128 fatals
 * (e.g. dubious ownership) are broken environments, surfaced rather than
 * misread as "outside a repository".
 */
export async function isInsideGitRepository(
  run: CommandRunner,
  cwd: string,
): Promise<boolean> {
  const result = await runCapture(run, ['-C', cwd, 'rev-parse', '--git-dir']);
  if (result.code === 0) return true;
  if (result.code === 128 && result.stderr.includes('not a git repository')) {
    return false;
  }
  throw new ProvisioningError(
    formatCommandFailure(`git -C ${cwd} rev-parse --git-dir failed`, result),
  );
}

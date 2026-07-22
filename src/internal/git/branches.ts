import { CommandLineError, ProvisioningError } from '../../errors';
import { runCapture, runStep } from '../../git/run';
import type { CommandRunner } from '../../host/command';

interface DeletionRequest {
  readonly branches: readonly string[];
  readonly to: string | null;
}

/**
 * Move to a destination branch, update it, delete the requested local
 * branches, and prune stale origin refs. The destination is `--to <branch>`
 * (alias `-t`), defaulting to the default branch resolved from origin/HEAD.
 * The whole request is validated before any git state changes.
 */
export async function deleteBranches(
  run: CommandRunner,
  tokens: readonly string[],
  write: (message: string) => void = () => {},
): Promise<void> {
  const { branches, to } = parseTokens(tokens);
  if (branches.length === 0) {
    throw new CommandLineError('At least one branch to delete is required.');
  }
  if (to?.startsWith('-')) {
    throw new CommandLineError(
      `Invalid destination '${to}': a branch name cannot begin with '-'.`,
    );
  }

  const base = await resolveDefaultBranch(run);
  const destination = to ?? base;

  if (branches.includes(base)) {
    throw new CommandLineError(`Cannot delete the default branch '${base}'.`);
  }
  if (branches.includes(destination)) {
    throw new CommandLineError(
      `Cannot delete the destination branch '${destination}'.`,
    );
  }

  const missing = await findMissingLocalBranches(run, branches);
  if (missing.length > 0) {
    throw new CommandLineError(`No such local branch: ${missing.join(', ')}.`);
  }

  write(`Moving to ${destination}, deleting ${branches.join(', ')}...\n`);

  // The destination is validated above; `git checkout <branch>` switches
  // branches (a `--` here would make git read the name as a pathspec instead).
  await runStep(run, ['checkout', destination]);
  await runStep(run, ['pull']);
  await runStep(run, ['branch', '-D', '--', ...branches]);
  await runStep(run, ['remote', 'prune', 'origin']);
}

function parseTokens(tokens: readonly string[]): DeletionRequest {
  const branches: string[] = [];
  let to: string | null = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    if (token === '--to' || token === '-t') {
      if (to !== null) {
        throw new CommandLineError(
          'The destination may be specified only once.',
        );
      }
      const value = tokens[index + 1];
      if (value === undefined) {
        throw new CommandLineError(`${token} requires a branch name.`);
      }
      to = value;
      index += 1;
      continue;
    }
    if (token === '--') {
      throw new CommandLineError(
        "'--' is not supported; use --to <branch> to choose the destination.",
      );
    }
    if (!branches.includes(token)) {
      branches.push(token);
    }
  }
  return { branches, to };
}

async function findMissingLocalBranches(
  run: CommandRunner,
  branches: readonly string[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const branch of branches) {
    const result = await runCapture(run, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]);
    if (result.code !== 0) {
      missing.push(branch);
    }
  }
  return missing;
}

async function resolveDefaultBranch(run: CommandRunner): Promise<string> {
  const result = await runCapture(run, [
    'rev-parse',
    '--abbrev-ref',
    'origin/HEAD',
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      'Unable to resolve the default branch: origin/HEAD is not set. Run `git remote set-head origin --auto` to fix this.',
    );
  }
  const ref = result.stdout.trim();
  const prefix = 'origin/';
  if (!ref.startsWith(prefix)) {
    throw new ProvisioningError(
      `Unexpected origin/HEAD format: "${ref}". Expected "origin/<branch>".`,
    );
  }
  return ref.slice(prefix.length);
}

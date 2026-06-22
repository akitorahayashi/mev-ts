import { CommandLineError, ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../resources/model';

const DEFAULT_CHECKOUT_BRANCH = 'main';

interface BranchDeletion {
  readonly deleteBranches: readonly string[];
  readonly checkoutBranch: string;
}

/**
 * Update the checkout branch, delete the requested local branches, and prune
 * stale origin refs.
 *
 * Tokens before a `--` separator are local branch names to delete. When a
 * separator is present, the single token after it is the branch to checkout
 * before deletion; without a separator, `main` is used. All arguments are
 * validated before any git command runs.
 */
export async function deleteBranches(
  run: CommandRunner,
  tokens: readonly string[],
): Promise<void> {
  const request = parse(tokens);
  await runStep(run, ['checkout', request.checkoutBranch]);
  await runStep(run, ['pull']);
  await runStep(run, ['branch', '-D', '--', ...request.deleteBranches]);
  await runStep(run, ['remote', 'prune', 'origin']);
}

function parse(tokens: readonly string[]): BranchDeletion {
  const separator = tokens.indexOf('--');
  if (separator === -1) {
    if (tokens.length === 0) {
      throw new CommandLineError('At least one branch to delete is required.');
    }
    return validate(tokens, DEFAULT_CHECKOUT_BRANCH);
  }

  const deleteBranches = tokens.slice(0, separator);
  const checkoutBranches = tokens.slice(separator + 1);

  if (deleteBranches.length === 0) {
    throw new CommandLineError(
      'At least one branch to delete is required before `--`.',
    );
  }
  if (checkoutBranches.length === 0) {
    throw new CommandLineError('A checkout branch is required after `--`.');
  }
  if (checkoutBranches.length > 1) {
    throw new CommandLineError(
      'Only one checkout branch is allowed after `--`.',
    );
  }

  return validate(deleteBranches, checkoutBranches[0] as string);
}

function validate(
  deleteBranches: readonly string[],
  checkoutBranch: string,
): BranchDeletion {
  if (deleteBranches.includes(checkoutBranch)) {
    throw new CommandLineError(
      `Cannot delete the checkout branch '${checkoutBranch}'.`,
    );
  }
  return { deleteBranches, checkoutBranch };
}

async function runStep(
  run: CommandRunner,
  args: readonly string[],
): Promise<void> {
  const result = await run.run('git', args);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git ${args.join(' ')} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

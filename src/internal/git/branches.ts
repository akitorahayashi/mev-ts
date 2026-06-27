import { CommandLineError, ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

export async function deleteBranches(
  run: CommandRunner,
  tokens: readonly string[],
): Promise<void> {
  if (tokens.length === 0) {
    throw new CommandLineError('At least one branch to delete is required.');
  }

  const current = await resolveCurrentBranch(run);
  const base = await resolveDefaultBranch(run);

  if (tokens.includes(base)) {
    throw new CommandLineError(`Cannot delete the default branch '${base}'.`);
  }

  if (tokens.includes(current)) {
    await runStep(run, ['checkout', base]);
    await runStep(run, ['pull']);
  }

  await runStep(run, ['branch', '-D', '--', ...tokens]);
  await runStep(run, ['remote', 'prune', 'origin']);
}

async function resolveCurrentBranch(run: CommandRunner): Promise<string> {
  const result = await run.run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `Failed to resolve current branch: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  return result.stdout.trim();
}

async function resolveDefaultBranch(run: CommandRunner): Promise<string> {
  const result = await run.run('git', [
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

async function runStep(
  run: CommandRunner,
  args: readonly string[],
): Promise<void> {
  const result = await run.run('git', args, {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git ${args.join(' ')} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

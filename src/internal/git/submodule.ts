import { rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { CommandLineError, ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

/**
 * Delete a git submodule completely from the repository in the current working
 * directory: deinit the worktree, remove the tracked path, delete the
 * `.git/modules/<path>` directory, and drop the `.gitmodules` config section.
 */
export async function deleteSubmodule(
  run: CommandRunner,
  tokens: readonly string[],
): Promise<void> {
  const submodulePath = parsePath(tokens);

  process.stdout.write(`Deleting submodule ${submodulePath}...\n`);
  await runStep(run, ['submodule', 'deinit', '-f', submodulePath]);
  await runStep(run, ['rm', '-f', '-r', submodulePath]);
  await removeModuleDir(run, submodulePath);
  await removeConfigSection(run, submodulePath);
  process.stdout.write(`Submodule ${submodulePath} deleted successfully.\n`);
}

function parsePath(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    throw new CommandLineError('A submodule path is required.');
  }
  if (tokens.length > 1) {
    throw new CommandLineError('Only one submodule path is allowed.');
  }
  return validatePath(tokens[0] as string);
}

/**
 * A submodule path must be a relative path without traversal. Absolute paths or
 * any `.`/`..` segment are rejected so deletion cannot escape the repository.
 */
function validatePath(path: string): string {
  const segments = path.split(/[/\\]/);
  const isValid =
    path.length > 0 &&
    !isAbsolute(path) &&
    segments.every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..',
    );

  if (!isValid) {
    throw new CommandLineError(
      `Invalid submodule path '${path}': must be a relative path without traversal.`,
    );
  }
  return path;
}

async function removeModuleDir(
  run: CommandRunner,
  submodulePath: string,
): Promise<void> {
  const result = await run.run('git', ['rev-parse', '--git-dir']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git rev-parse --git-dir failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  const gitDir = result.stdout.trim();
  const base = isAbsolute(gitDir) ? gitDir : join(process.cwd(), gitDir);
  const modulesPath = join(base, 'modules', submodulePath);

  const exists = await stat(modulesPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    await rm(modulesPath, { recursive: true, force: true });
  }
}

async function removeConfigSection(
  run: CommandRunner,
  submodulePath: string,
): Promise<void> {
  const result = await run.run('git', [
    'config',
    '--remove-section',
    `submodule.${submodulePath}`,
  ]);
  // A missing section means the submodule was already partially removed, which
  // is an acceptable terminal state rather than a failure.
  if (result.code !== 0 && !/No such section/.test(result.stderr)) {
    throw new ProvisioningError(
      `git config --remove-section submodule.${submodulePath} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
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
      `git ${args.join(' ')} failed with code ${result.code}: ${result.stderr || result.stdout || 'see command output above'}`,
    );
  }
}

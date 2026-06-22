import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../resources/model';

export async function defaultBranch(
  run: CommandRunner,
  cwd: string,
): Promise<string> {
  const result = await run.run('git', [
    '-C',
    cwd,
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

export async function deleteMergedBranches(
  run: CommandRunner,
  cwd: string,
  base: string,
): Promise<string[]> {
  const listResult = await run.run('git', [
    '-C',
    cwd,
    'branch',
    '--merged',
    base,
    '--format=%(refname:short)',
  ]);
  if (listResult.code !== 0) {
    throw new ProvisioningError(
      `git branch --merged failed: ${listResult.stderr || listResult.stdout || 'unknown error'}`,
    );
  }

  const currentResult = await run.run('git', [
    '-C',
    cwd,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  const current = currentResult.code === 0 ? currentResult.stdout.trim() : null;

  const candidates = listResult.stdout
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && b !== base && b !== current);

  const deleted: string[] = [];
  for (const branch of candidates) {
    const deleteResult = await run.run('git', [
      '-C',
      cwd,
      'branch',
      '-d',
      branch,
    ]);
    if (deleteResult.code !== 0) {
      throw new ProvisioningError(
        `Failed to delete branch "${branch}": ${deleteResult.stderr || deleteResult.stdout || 'unknown error'}`,
      );
    }
    deleted.push(branch);
  }

  return deleted;
}

export async function isRepo(
  run: CommandRunner,
  cwd: string,
): Promise<boolean> {
  const result = await run.run('git', [
    '-C',
    cwd,
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  return result.code === 0;
}

export async function clone(
  run: CommandRunner,
  url: string,
  dest: string,
): Promise<void> {
  const result = await run.run('git', ['clone', url, dest]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git clone ${url} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

export async function fetch(run: CommandRunner, cwd: string): Promise<void> {
  const result = await run.run('git', ['-C', cwd, 'fetch']);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git fetch failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

export async function remoteGetUrl(
  run: CommandRunner,
  cwd: string,
  remote: string,
): Promise<string | null> {
  const result = await run.run('git', ['-C', cwd, 'remote', 'get-url', remote]);
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

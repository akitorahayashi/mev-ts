import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../resources/model';

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

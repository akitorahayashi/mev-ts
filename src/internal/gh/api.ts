import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

export async function get<T>(run: CommandRunner, path: string): Promise<T> {
  const result = await run.run('gh', ['api', path]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `gh api ${path} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  return JSON.parse(result.stdout) as T;
}

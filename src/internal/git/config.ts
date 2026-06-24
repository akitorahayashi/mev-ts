import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

export async function configGet(
  run: CommandRunner,
  name: string,
): Promise<string | null> {
  const result = await run.run('git', ['config', '--global', '--get', name]);
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

export async function configSetGlobal(
  run: CommandRunner,
  name: string,
  value: string,
): Promise<void> {
  const result = await run.run('git', ['config', '--global', name, value]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git config --global ${name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

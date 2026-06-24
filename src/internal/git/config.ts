import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../resources/model';

export async function configGet(
  run: CommandRunner,
  name: string,
): Promise<string | null> {
  const result = await run.run('git', ['config', '--global', '--get', name]);
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

export async function configSet(
  run: CommandRunner,
  file: string,
  name: string,
  value: string,
): Promise<void> {
  const result = await run.run('git', ['config', '--file', file, name, value]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `git config ${name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
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

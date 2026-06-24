import { ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

export async function extensionInstalled(
  run: CommandRunner,
  name: string,
): Promise<boolean> {
  const result = await run.run('gh', ['extension', 'list']);
  if (result.code !== 0) return false;
  return result.stdout
    .split('\n')
    .some((line) => line.trim().split(/\s+/)[0] === name);
}

export async function extensionInstall(
  run: CommandRunner,
  name: string,
): Promise<void> {
  const result = await run.run('gh', ['extension', 'install', name]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      `gh extension install ${name} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
}

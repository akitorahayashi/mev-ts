import { ProvisioningError } from '../../errors';
import { type CommandRunner, formatCommandFailure } from '../../host/command';
import { runCapture } from './run';

export async function configGet(
  run: CommandRunner,
  name: string,
): Promise<string | null> {
  const result = await runCapture(run, ['config', '--global', '--get', name]);
  // `git config --get` documents exit code 1 for a missing key: the unset
  // signal. Any other non-zero (e.g. 127 when git is absent) is a broken
  // environment, surfaced rather than masked as unset.
  if (result.code === 1) return null;
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`git config --global --get ${name} failed`, result),
    );
  }
  return result.stdout.trim();
}

export async function configSetGlobal(
  run: CommandRunner,
  name: string,
  value: string,
): Promise<void> {
  const result = await runCapture(run, ['config', '--global', name, value]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`git config --global ${name} failed`, result),
    );
  }
}

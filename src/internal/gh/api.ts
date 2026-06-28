import { ProvisioningError } from '../../errors';
import { type CommandRunner, formatCommandFailure } from '../../host/command';

export async function get<T>(run: CommandRunner, path: string): Promise<T> {
  const result = await run.run('gh', ['api', path]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`gh api ${path} failed`, result),
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse gh api ${path} output as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

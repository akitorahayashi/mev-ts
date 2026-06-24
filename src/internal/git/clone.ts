import { CommandLineError, ProvisioningError } from '../../errors';
import type { CommandRunner } from '../../host/command';

/**
 * Clone each repository URL in order, stopping at the first failure.
 *
 * Tokens before a `--` separator are repository URLs; tokens after it are
 * `git clone` flags applied to every clone (e.g. `urlA urlB -- --depth 1`).
 */
export async function cloneRepositories(
  run: CommandRunner,
  tokens: readonly string[],
): Promise<void> {
  const separator = tokens.indexOf('--');
  const urls = separator === -1 ? tokens : tokens.slice(0, separator);
  const flags = separator === -1 ? [] : tokens.slice(separator + 1);

  if (urls.length === 0) {
    throw new CommandLineError('At least one repository URL is required.');
  }

  for (const url of urls) {
    process.stdout.write(`Cloning ${url}...\n`);
    const result = await run.run('git', ['clone', ...flags, url]);
    if (result.code !== 0) {
      throw new ProvisioningError(
        `git clone ${url} failed with code ${result.code}: ${result.stderr || result.stdout || 'unknown error'}`,
      );
    }
  }
}

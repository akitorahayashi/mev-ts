import { CommandLineError, ProvisioningError } from '../../errors';
import { type CommandRunner, formatCommandFailure } from '../../host/command';

function displayCloneUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = 'REDACTED';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Clone each repository URL in order, stopping at the first failure.
 *
 * Tokens before a `--` separator are repository URLs; tokens after it are
 * `git clone` flags applied to every clone (e.g. `urlA urlB -- --depth 1`).
 */
export async function cloneRepositories(
  run: CommandRunner,
  tokens: readonly string[],
  write: (msg: string) => void = () => {},
): Promise<void> {
  const separator = tokens.indexOf('--');
  const urls = separator === -1 ? tokens : tokens.slice(0, separator);
  const flags = separator === -1 ? [] : tokens.slice(separator + 1);

  if (urls.length === 0) {
    throw new CommandLineError('At least one repository URL is required.');
  }

  for (const url of urls) {
    const displayUrl = displayCloneUrl(url);
    write(`Cloning ${displayUrl}...\n`);
    const result = await run.run('git', ['clone', ...flags, url], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (result.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure(
          `git clone ${displayUrl} failed`,
          result,
          'see command output above',
        ),
      );
    }
  }
}

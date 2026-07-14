import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { runStep } from './run';

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
    // The raw url is passed to git, but the failure label uses the redacted one
    // so credentials never reach the error output.
    await runStep(run, ['clone', ...flags, url], `git clone ${displayUrl}`);
  }
}

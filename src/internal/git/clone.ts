import { CommandLineError } from '../../errors';
import type { CommandRunner } from '../../host/command';
import { runProcessStep } from '../../host/command-run';

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
 * Clone each repository URL through grove's local clone cache in order,
 * stopping at the first failure. Tokens after `--` are Git clone options
 * applied to every URL.
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

  // A dash-leading positional would be parsed by gv as a flag (argument
  // injection, no shell involved); repository URLs never start with '-'.
  const flaggish = urls.find((url) => url.startsWith('-'));
  if (flaggish !== undefined) {
    throw new CommandLineError(
      `Invalid repository URL '${flaggish}': must not start with '-'.`,
    );
  }

  for (const url of urls) {
    const displayUrl = displayCloneUrl(url);
    write(`Cloning ${displayUrl}...\n`);
    // The raw url is passed to gv, but the failure label uses the redacted one
    // so credentials never reach the error output.
    await runProcessStep(
      run,
      'gv',
      ['clone', ...flags, '--', url],
      `gv clone ${displayUrl} failed`,
      {
        stdout: 'inherit',
        stderr: 'inherit',
        fallback: 'see command output above',
      },
    );
  }
}

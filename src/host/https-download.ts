import { ProvisioningError } from '../errors';
import { type CommandRunner, formatCommandFailure } from './command';

/**
 * Fetch `url` into `output` over curl with HTTPS pinned on the initial request
 * and across redirects plus a TLS floor, so a redirect to http:// is refused
 * rather than silently followed. The `--` guard terminates option parsing before
 * the URL, so a URL beginning with '-' can never be read as a flag. Throws a
 * ProvisioningError labeled by `label` on a non-zero exit.
 */
export async function downloadOverHttps(
  run: CommandRunner,
  url: string,
  output: string,
  label: string,
): Promise<void> {
  const result = await run.run('curl', [
    '-fsSL',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--tlsv1.2',
    '-o',
    output,
    '--',
    url,
  ]);
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(`curl download failed for ${label}`, result),
    );
  }
}

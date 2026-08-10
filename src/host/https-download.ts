import type { CommandRunner } from './command';
import { runProcessStep } from './command-run';

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
  await runProcessStep(
    run,
    'curl',
    [
      '-fsSL',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--tlsv1.2',
      // No blanket --max-time: a release binary on a slow link is a legitimate
      // long transfer. The connect timeout bounds the connection phase only, so
      // the low-speed pair is what aborts a server that accepts and then stalls
      // mid-transfer: under 1 byte/s for 30s counts as dead.
      '--connect-timeout',
      '30',
      '--speed-limit',
      '1',
      '--speed-time',
      '30',
      '--retry',
      '2',
      '--retry-connrefused',
      '-o',
      output,
      '--',
      url,
    ],
    `curl download failed for ${label}`,
  );
}

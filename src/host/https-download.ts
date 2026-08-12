import { open } from 'node:fs/promises';
import { ProvisioningError } from '../errors';
import { type CommandRunner, formatCommandFailure } from './command';

// curl's exit code for an HTTP error under --fail(-with-body); every other
// non-zero exit is a transport failure whose detail lives in stderr.
const HTTP_FAILURE = 22;

const BODY_EXCERPT_LIMIT = 200;

// The error body is unbounded server input, so only this prefix is ever read
// from disk; it comfortably covers the excerpt even after control characters
// collapse.
const BODY_READ_BYTES = 2048;

/**
 * The transport-hardening baseline shared by every curl invocation mev issues:
 * HTTPS-only on the initial request, a TLS floor, a bounded connection phase,
 * and light retry. Operations compose their transfer-specific flags (redirect
 * policy, output, failure mode) on top, so the security posture is declared
 * once and cannot drift between call sites.
 */
export const hardenedCurlArgs = [
  '--proto',
  '=https',
  '--tlsv1.2',
  '--connect-timeout',
  '30',
  '--retry',
  '2',
  '--retry-connrefused',
] as const;

/**
 * Fetch `url` into `output` over curl with HTTPS pinned on the initial request
 * and across redirects plus a TLS floor, so a redirect to http:// is refused
 * rather than silently followed. The `--` guard terminates option parsing before
 * the URL, so a URL beginning with '-' can never be read as a flag. Throws a
 * ProvisioningError labeled by `label` on a non-zero exit.
 *
 * `--fail-with-body` (rather than `-f`) keeps the error response on disk so an
 * HTTP failure reports the status and the server's own explanation — a GitHub
 * rate-limit 403 says "API rate limit exceeded", where curl's stderr alone says
 * only "The requested URL returned error: 403".
 */
export async function downloadOverHttps(
  run: CommandRunner,
  url: string,
  output: string,
  label: string,
): Promise<void> {
  const result = await run.run('curl', [
    '-sSL',
    '--fail-with-body',
    ...hardenedCurlArgs,
    // -L follows redirects, so the HTTPS pin must extend across them too.
    '--proto-redir',
    '=https',
    // No blanket --max-time: a release binary on a slow link is a legitimate
    // long transfer. The connect timeout bounds the connection phase only, so
    // the low-speed pair is what aborts a server that accepts and then stalls
    // mid-transfer: under 1 byte/s for 30s counts as dead.
    '--speed-limit',
    '1',
    '--speed-time',
    '30',
    '-w',
    '%{http_code}',
    '-o',
    output,
    '--',
    url,
  ]);
  if (result.code === 0) return;
  const failure = `curl download failed for ${label}`;
  if (result.code === HTTP_FAILURE) {
    const body = await responseBodyExcerpt(output);
    throw new ProvisioningError(
      `${failure}: HTTP ${result.stdout.trim()}${body ? `: ${body}` : ''}`,
    );
  }
  throw new ProvisioningError(formatCommandFailure(failure, result));
}

/**
 * The error response curl left at `output`, flattened to one printable line
 * and truncated. This only enriches a failure that is already being thrown,
 * so an unreadable or empty body degrades to the bare status.
 */
async function responseBodyExcerpt(output: string): Promise<string> {
  let prefix: string;
  try {
    const file = await open(output, 'r');
    try {
      const buffer = Buffer.alloc(BODY_READ_BYTES);
      const { bytesRead } = await file.read(buffer, 0, BODY_READ_BYTES, 0);
      prefix = buffer.toString('utf8', 0, bytesRead);
    } finally {
      await file.close();
    }
  } catch {
    return '';
  }
  const printable = prefix.replace(/\p{C}+/gu, ' ').trim();
  return printable.length > BODY_EXCERPT_LIMIT
    ? `${printable.slice(0, BODY_EXCERPT_LIMIT)}…`
    : printable;
}

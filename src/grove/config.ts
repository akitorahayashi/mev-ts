import { ProvisioningError } from '../errors';
import {
  parseSshRemote,
  STOCK_SSH_HOST,
  sshRemoteUrl,
} from '../github/repository';
import { isRecord, requireRecord } from '../host/parse';
import { loadToml, serializeToml } from '../host/toml';

const SCHEMA_VERSION = 2;

// Only stock-host remotes are rewritten: an entry already pointing at a custom
// host was written that way deliberately. A remote without the `.git` suffix is
// rewritten with one, which is the form mev emits everywhere.
function renderUrl(url: string, host: string): string {
  const remote = parseSshRemote(url);
  return remote?.host === STOCK_SSH_HOST
    ? sshRemoteUrl(host, remote.repository)
    : url;
}

function renderRepositories(value: unknown, host: string, label: string): void {
  if (value === undefined) return;
  const repositories = requireRecord(value, label);
  for (const [name, entry] of Object.entries(repositories)) {
    if (typeof entry === 'string') {
      repositories[name] = renderUrl(entry, host);
      continue;
    }
    const url = isRecord(entry) ? entry['url'] : undefined;
    if (!isRecord(entry) || typeof url !== 'string') {
      throw new ProvisioningError(
        `${label} '${name}' must be a URL string or a table with a string url.`,
      );
    }
    entry['url'] = renderUrl(url, host);
  }
}

function renderScope(
  scope: Record<string, unknown>,
  host: string,
  label: string,
): void {
  renderRepositories(scope['repos'], host, `${label} repos`);
  if (scope['groups'] === undefined) return;
  const groups = requireRecord(scope['groups'], `${label} groups`);
  for (const [directory, repositories] of Object.entries(groups)) {
    renderRepositories(repositories, host, `${label} groups.${directory}`);
  }
}

/**
 * Rewrite every stock-host GitHub remote in the catalog to reach the
 * per-machine SSH alias. `sshHost` is validated by the store it comes from
 * (`github/ssh-host.ts`), the sole authority for the alias's shape. Grove owns
 * the schema and validates the rendered file; this checks only the version and
 * the URL positions it rewrites.
 */
export function renderConfig(
  raw: string,
  host: string,
  source: string,
): string {
  const config = loadToml(raw, source);
  if (config['version'] !== SCHEMA_VERSION) {
    throw new ProvisioningError(`${source} version must be ${SCHEMA_VERSION}.`);
  }
  renderScope(config, host, source);
  if (config['removed'] !== undefined) {
    renderScope(
      requireRecord(config['removed'], `${source} removed`),
      host,
      `${source} removed`,
    );
  }
  return serializeToml(config);
}

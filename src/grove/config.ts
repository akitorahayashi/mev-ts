import { ProvisioningError } from '../errors';
import {
  parseSshRemote,
  STOCK_SSH_HOST,
  sshRemoteUrl,
} from '../github/repository';
import { requireRecord } from '../host/parse';
import { loadToml, serializeToml } from '../host/toml';

/**
 * Rewrite every stock-host GitHub remote in the catalog to reach the
 * per-machine SSH alias. `sshHost` is validated by the store it comes from
 * (`github/ssh-host.ts`), the sole authority for the alias's shape.
 */
export function renderConfig(
  raw: string,
  host: string,
  source: string,
): string {
  const config = loadToml(raw, source);
  const repos = requireRecord(config['repos'], `${source} repos`);

  for (const [name, value] of Object.entries(repos)) {
    const repo = requireRecord(value, `${source} repository '${name}'`);
    const url = repo['url'];
    if (typeof url !== 'string') {
      throw new ProvisioningError(
        `${source} repository '${name}' url must be a string.`,
      );
    }
    // Only stock-host remotes are rewritten: an entry already pointing at a
    // custom host was written that way deliberately. A remote without the `.git`
    // suffix is rewritten with one, which is the form mev emits everywhere.
    const remote = parseSshRemote(url);
    if (remote?.host === STOCK_SSH_HOST) {
      repo['url'] = sshRemoteUrl(host, remote.repository);
    }
  }

  return serializeToml(config);
}

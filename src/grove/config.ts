import { ProvisioningError } from '../errors';
import { requireSshHost } from '../github/ssh-host';
import { requireRecord } from '../host/parse';
import { loadToml, serializeToml } from '../host/toml';

const GITHUB_SSH_PREFIX = 'git@github.com:';

export function renderConfig(
  raw: string,
  sshHost: string,
  source: string,
): string {
  const host = requireSshHost(sshHost);
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
    if (url.startsWith(GITHUB_SSH_PREFIX)) {
      repo['url'] = `git@${host}:${url.slice(GITHUB_SSH_PREFIX.length)}`;
    }
  }

  return serializeToml(config);
}

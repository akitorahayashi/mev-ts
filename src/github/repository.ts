/** A GitHub repository, identified by the pair that survives a transport change. */
export interface Repository {
  readonly owner: string;
  readonly name: string;
}

/** SCP-style git remote reaching a repository through an SSH host alias. */
export function sshRemoteUrl(sshHost: string, repository: Repository): string {
  return `git@${sshHost}:${repository.owner}/${repository.name}.git`;
}

// mev registers exclusively through sshRemoteUrl, so a remote in any other
// form was registered outside mev and stays deliberately unrecognized.
const SSH_REMOTE = /^git@[^:]+:([^/]+)\/([^/]+)\.git$/;

/**
 * Whether a registered git remote points at this repository. The host segment
 * is ignored because it is the SSH alias `mev config ssh-host` sets per
 * machine — transport, not identity, and outside the target signature — so a
 * marketplace registered under a previous alias is still this repository.
 */
export function remoteMatchesRepository(
  url: string | undefined,
  repository: Repository,
): boolean {
  const match = url === undefined ? null : SSH_REMOTE.exec(url);
  if (!match) return false;
  const [, owner, name] = match;
  return owner === repository.owner && name === repository.name;
}

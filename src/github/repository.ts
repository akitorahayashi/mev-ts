import { ProvisioningError } from '../errors';

/** A GitHub repository, identified by the pair that survives a transport change. */
export interface Repository {
  readonly owner: string;
  readonly name: string;
}

// Both segments reach a public URL, so the repo-owned manifests that declare
// them are validated against an explicit character set rather than trusted.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Parse the `owner/name` spelling every manifest uses. The one owner of that
 * spelling, so `release.ts` and the plugin catalog cannot drift into accepting
 * different things.
 */
export function parseRepository(value: unknown, label: string): Repository {
  const segments = typeof value === 'string' ? value.split('/') : [];
  const [owner = '', name = ''] = segments;
  if (
    segments.length !== 2 ||
    !SAFE_SEGMENT.test(owner) ||
    !SAFE_SEGMENT.test(name)
  ) {
    throw new ProvisioningError(
      `${label} must be a GitHub repository in owner/name form, each segment starting with a letter or digit and containing only letters, digits, '.', '_', and '-'.`,
    );
  }
  return { owner, name };
}

/** The `owner/name` spelling, for URLs and messages. */
export function repositoryPath(repository: Repository): string {
  return `${repository.owner}/${repository.name}`;
}

/** The host GitHub serves under when no per-machine SSH alias is configured. */
export const STOCK_SSH_HOST = 'github.com';

/** SCP-style git remote reaching a repository through an SSH host alias. */
export function sshRemoteUrl(sshHost: string, repository: Repository): string {
  return `git@${sshHost}:${repositoryPath(repository)}.git`;
}

/**
 * The SCP-style remote shape. The `.git` suffix is optional in the pattern so
 * one parser serves both consumers, and each states its own requirement: mev
 * registers marketplaces exclusively through `sshRemoteUrl`, which always emits
 * the suffix, while a hand-written Grove catalog entry may omit it.
 */
const SSH_REMOTE = /^git@([^:/]+):([^/]+)\/(.+?)(\.git)?$/;

export interface SshRemote {
  readonly host: string;
  readonly repository: Repository;
  readonly hasGitSuffix: boolean;
}

export function parseSshRemote(url: string): SshRemote | null {
  const match = SSH_REMOTE.exec(url);
  if (!match) return null;
  const [, host, owner, name, suffix] = match;
  if (!host || !owner || !name) return null;
  return {
    host,
    repository: { owner, name },
    hasGitSuffix: suffix !== undefined,
  };
}

/**
 * Whether a registered git remote points at this repository. The host segment
 * is ignored because it is the SSH alias `mev config ssh-host` sets per
 * machine — transport, not identity, and outside the target signature — so a
 * marketplace registered under a previous alias is still this repository. The
 * `.git` suffix is required: mev registers exclusively through `sshRemoteUrl`,
 * so a remote in any other form was registered outside mev and stays
 * deliberately unrecognized.
 */
export function remoteMatchesRepository(
  url: string | undefined,
  repository: Repository,
): boolean {
  const remote = url === undefined ? null : parseSshRemote(url);
  if (!remote?.hasGitSuffix) return false;
  return (
    remote.repository.owner === repository.owner &&
    remote.repository.name === repository.name
  );
}

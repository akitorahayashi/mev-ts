import { errorMessage, ProvisioningError } from '../errors';
import { readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { mevPath, resolveHostPath } from '../host/path';

/**
 * Every GitHub connection over SSH resolves its host alias here, so one
 * per-machine setting covers all consumers. An absent store means the stock
 * `github.com` host; only `mev config ssh-host` writes an override, and SSH
 * configuration owns the alias's real hostname, port, and key.
 */
const DEFAULT_SSH_HOST = 'github.com';

const SAFE_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function requireSshHost(value: unknown, label = 'SSH host'): string {
  if (typeof value !== 'string' || !SAFE_HOST.test(value)) {
    throw new ProvisioningError(
      `${label} must contain only letters, digits, '.', '_', and '-', and must start with a letter or digit.`,
    );
  }
  return value;
}

/** SCP-style git remote for a repository reached through the SSH host alias. */
export function sshRemoteUrl(
  sshHost: string,
  owner: string,
  repository: string,
): string {
  return `git@${sshHost}:${owner}/${repository}.git`;
}

export function sshHostPath(home: string): string {
  return resolveHostPath(mevPath('ssh-host'), home);
}

export async function readSshHost(home: string): Promise<string> {
  const path = sshHostPath(home);
  let raw: string | null;
  try {
    raw = await readTextIfPresent(path);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to read GitHub SSH host at ${path}: ${errorMessage(error)}`,
    );
  }
  if (raw === null) return DEFAULT_SSH_HOST;
  return requireSshHost(raw.trim(), `GitHub SSH host ${path}`);
}

export async function writeSshHost(
  home: string,
  sshHost: string,
): Promise<string> {
  const host = requireSshHost(sshHost.trim());
  const path = sshHostPath(home);
  try {
    await writeFileAtomically(path, `${host}\n`);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to write GitHub SSH host at ${path}: ${errorMessage(error)}`,
    );
  }
  return path;
}

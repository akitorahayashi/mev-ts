import { requireSshHost, writeSshHost } from '../github/ssh-host';
import { invalidateInput } from './invalidate-input';

/**
 * Store the per-machine SSH host alias, first marking every target that bakes it
 * into applied output as stale. The set is derived from the registry rather than
 * named here, so a new target that materializes the host declares that itself
 * instead of relying on this call site being updated to match.
 */
export async function configureSshHost(
  home: string,
  sshHost: string,
): Promise<string> {
  const host = requireSshHost(sshHost.trim());
  await invalidateInput(home, 'githubSshHost');
  return writeSshHost(home, host);
}

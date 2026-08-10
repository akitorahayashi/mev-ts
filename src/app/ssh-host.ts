import { requireSshHost, writeSshHost } from '../github/ssh-host';
import { appliedPath, invalidateApplied } from '../provisioning/applied';
import { allTargets } from '../provisioning/registry';

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
  const stale = allTargets().filter((target) =>
    target.perMachineInputs.includes('githubSshHost'),
  );
  await Promise.all(
    stale.map((target) => invalidateApplied(appliedPath(home, target.name))),
  );
  return writeSshHost(home, host);
}

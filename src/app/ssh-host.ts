import { requireSshHost, writeSshHost } from '../github/ssh-host';
import { appliedPath, invalidateApplied } from '../provisioning/applied';
import { groveTarget } from '../provisioning/targets/grove';

export async function configureSshHost(
  home: string,
  sshHost: string,
): Promise<string> {
  const host = requireSshHost(sshHost.trim());
  await invalidateApplied(appliedPath(home, groveTarget.name));
  return writeSshHost(home, host);
}

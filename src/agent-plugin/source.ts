import { errorMessage, ProvisioningError } from '../errors';
import { readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { requireExactKeys, requireRecord } from '../host/parse';
import { mevPath, resolveHostPath } from '../host/path';
import { dumpYaml, loadYaml } from '../host/yaml';
import { requireSshHost } from './catalog';

export function pluginSourcePath(home: string): string {
  return resolveHostPath(mevPath('coder', 'plugin-source.yml'), home);
}

export async function readPluginSshHost(
  home: string,
  defaultSshHost: string,
): Promise<string> {
  const path = pluginSourcePath(home);
  let raw: string | null;
  try {
    raw = await readTextIfPresent(path);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to read agent plugin source at ${path}: ${errorMessage(error)}`,
    );
  }
  if (raw === null) return requireSshHost(defaultSshHost);

  const label = `Agent plugin source ${path}`;
  const parsed = requireRecord(loadYaml(raw, path), label);
  requireExactKeys(parsed, ['ssh_host'], label);
  return requireSshHost(parsed['ssh_host'], `${label} ssh_host`);
}

export async function writePluginSshHost(
  home: string,
  sshHost: string,
): Promise<string> {
  const host = requireSshHost(sshHost.trim());
  const path = pluginSourcePath(home);
  try {
    await writeFileAtomically(path, dumpYaml({ ssh_host: host }));
  } catch (error) {
    throw new ProvisioningError(
      `Failed to write agent plugin source at ${path}: ${errorMessage(error)}`,
    );
  }
  return path;
}

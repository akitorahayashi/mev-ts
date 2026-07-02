import { ProvisioningError } from '../../errors';
import { readDirentsIfPresent } from '../../host/absence';

const JSON_SUFFIX = '.json';

/**
 * The catalog of override fragments, authoritative from what's on disk: every
 * `<name>.json` file in the deployed overrides directory is a selectable
 * override named `<name>`.
 */
export async function readOverrides(sourceDir: string): Promise<string[]> {
  const entries = await readDirentsIfPresent(sourceDir);
  if (entries === null) {
    throw new ProvisioningError(
      `Zed overrides source directory is missing: ${sourceDir}. Run provisioning to deploy it first.`,
    );
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_SUFFIX))
    .map((entry) => entry.name.slice(0, -JSON_SUFFIX.length))
    .sort();
}

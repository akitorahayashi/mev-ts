import { readFile } from 'node:fs/promises';
import { deployedPath } from '../../assets/ref';
import { ProvisioningError } from '../../errors';
import { isNotFound } from '../../host/absence';

/**
 * Read a deployed manifest and hand its contents to `parse`. Only a missing
 * file (`ENOENT`) becomes the deploy-first guidance, named by `label`; every
 * other filesystem failure keeps its cause rather than being mislabeled as
 * not-found. `parse` may be asynchronous so a kind can `await import('js-yaml')`
 * inside it.
 */
export async function readDeployedManifest<T>(
  configKey: string,
  home: string,
  parse: (raw: string, path: string) => T | Promise<T>,
  label: string,
): Promise<T> {
  const path = deployedPath({ key: configKey }, home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      throw new ProvisioningError(
        `${label} not found: ${path}. Run without --plan to deploy first.`,
      );
    }
    throw error;
  }
  return parse(raw, path);
}

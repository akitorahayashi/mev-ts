import { deployedPath } from '../../assets/ref';
import { readDeployedText } from '../../host/deployed-file';

/**
 * Read a deployed manifest and hand its contents to `parse`. Only a missing
 * file becomes the deploy-first guidance, named by `label`; every other
 * filesystem failure keeps its cause rather than being mislabeled as not-found.
 * `parse` may be synchronous or asynchronous so kind-specific parsing and
 * probing can share the same manifest reader.
 */
export async function readDeployedManifest<T>(
  configKey: string,
  home: string,
  parse: (raw: string, path: string) => T | Promise<T>,
  label: string,
): Promise<T> {
  const path = deployedPath({ key: configKey }, home);
  const raw = await readDeployedText(path, label);
  return parse(raw, path);
}

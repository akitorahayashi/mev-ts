import { join } from 'node:path';

/**
 * Reference to an embedded configuration asset. The key doubles as the asset
 * registry lookup and the path under the deployed config root, so the deployed
 * file keeps its dotfile name even though the embedded source file does not.
 */
export interface AssetRef {
  readonly key: string;
}

export function asset(key: string): AssetRef {
  return { key };
}

const deployRoot = '.config/mev/roles';

/** Concrete path where the asset is materialized before it is symlinked. */
export function deployedPath(ref: AssetRef, homeDir: string): string {
  return join(homeDir, deployRoot, ref.key);
}

/** Stable, home-independent rendering of the deployed path. */
export function deployedSymbolic(ref: AssetRef): string {
  return `~/${deployRoot}/${ref.key}`;
}

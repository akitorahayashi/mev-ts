import { mevPath, resolveHostPath, symbolic } from '../host/path';

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

/** Root, relative to the user's home, where assets are materialized. */
export const deployRoot = mevPath('roles').rel;

/** Concrete path where the asset is materialized before it is symlinked. */
export function deployedPath(ref: AssetRef, homeDir: string): string {
  return resolveHostPath(mevPath('roles', ref.key), homeDir);
}

export function deployedDir(prefix: string, homeDir: string): string {
  return resolveHostPath(mevPath('roles', prefix), homeDir);
}

export function deployedSymbolic(ref: AssetRef): string {
  return symbolic(mevPath('roles', ref.key));
}

export function deployedDirSymbolic(prefix: string): string {
  return symbolic(mevPath('roles', prefix));
}

import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { lstatIfPresent } from '../../src/host/absence';

export async function pathExists(path: string): Promise<boolean> {
  return (await lstatIfPresent(path)) !== null;
}

/**
 * Staging directories a swap transaction would have left beside `path`. An
 * empty result is the no-residue assertion every atomic primitive makes.
 */
export async function stagingSiblings(path: string): Promise<string[]> {
  const prefix = `.${basename(path)}.`;
  return (await readdir(dirname(path)))
    .filter((name) => name.startsWith(prefix))
    .sort();
}

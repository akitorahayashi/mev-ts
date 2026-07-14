import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Create a fresh sibling staging directory for a same-parent atomic swap of
 * `path`. The parent is created and realpath-resolved first so the eventual
 * rename stays on the target's filesystem (atomic on APFS).
 */
export async function transactionDirectory(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const parent = await realpath(dirname(path));
  return mkdtemp(join(parent, `.${basename(path)}.`));
}

import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound } from './absence';
import { runWithCleanup } from './cleanup-error';
import { transactionDirectory } from './transaction';

export async function writeFileAtomically(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  await replaceFileAtomically(path, async (tmp) => {
    await writeFile(tmp, data, { flag: 'wx' });
  });
}

export async function replaceFileAtomically(
  path: string,
  writeTemp: (tmp: string) => Promise<void>,
): Promise<void> {
  const transaction = await transactionDirectory(path);
  const tmp = join(transaction, 'file');
  await runWithCleanup(
    async () => {
      await writeTemp(tmp);
      // Adopted host files can carry tightened modes (e.g. a 0600 config);
      // renaming the umask-default temp file over them must not widen those,
      // so the replacement inherits the destination's resolved mode.
      const existing = await statIfPresent(path);
      if (existing?.isFile()) {
        await chmod(tmp, existing.mode & 0o7777);
      }
      await rename(tmp, path);
    },
    () => rm(transaction, { force: true, recursive: true }),
    `Failed to clean up temporary file transaction for ${path}.`,
  );
}

async function statIfPresent(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

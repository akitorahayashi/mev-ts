import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
      await rename(tmp, path);
    },
    () => rm(transaction, { force: true, recursive: true }),
    `Failed to clean up temporary file transaction for ${path}.`,
  );
}

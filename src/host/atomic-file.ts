import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { throwWithCleanupError } from './cleanup-error';

const noFailure = Symbol('noFailure');

async function siblingTransactionDirectory(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const parent = await realpath(dirname(path));
  return mkdtemp(join(parent, `.${basename(path)}.`));
}

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
  const transaction = await siblingTransactionDirectory(path);
  const tmp = join(transaction, 'file');
  let primary: unknown = noFailure;
  try {
    await writeTemp(tmp);
    await rename(tmp, path);
  } catch (error) {
    primary = error;
  }

  try {
    await rm(transaction, { force: true, recursive: true });
  } catch (cleanup) {
    if (primary !== noFailure) {
      throwWithCleanupError(
        primary,
        cleanup,
        `Failed to clean up temporary file transaction for ${path}.`,
      );
    }
    throw cleanup;
  }
  if (primary !== noFailure) throw primary;
}

import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { lstatIfPresent } from './absence';

function siblingPath(path: string, suffix: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.${suffix}`,
  );
}

export async function replaceDirectoryAfterBuild(
  path: string,
  buildDirectory: (tmp: string) => Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = siblingPath(path, 'tmp');
  const backup = siblingPath(path, 'old');
  await mkdir(tmp, { recursive: true });

  try {
    await buildDirectory(tmp);

    const present = (await lstatIfPresent(path)) !== null;
    if (!present) {
      await rename(tmp, path);
      return;
    }

    await rename(path, backup);
    try {
      await rename(tmp, path);
    } catch (error) {
      try {
        await rename(backup, path);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Failed to replace ${path} and restore its previous contents.`,
        );
      }
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

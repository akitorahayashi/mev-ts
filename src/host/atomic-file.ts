import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

function siblingTempPath(path: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
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
  await mkdir(dirname(path), { recursive: true });
  const tmp = siblingTempPath(path);
  try {
    await writeTemp(tmp);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { lstatIfPresent } from './absence';
import { withSwapTransaction } from './transaction';

async function matchesRegularFile(
  path: string,
  expected: Buffer,
  expectedMode: number,
): Promise<boolean> {
  const current = await lstatIfPresent(path);
  if (!current?.isFile()) return false;
  if ((current.mode & 0o111) !== (expectedMode & 0o111)) return false;
  if (current.size !== expected.byteLength) return false;
  return (await readFile(path)).equals(expected);
}

export async function reconcileRegularFile(
  path: string,
  contents: Buffer,
  mode: number,
): Promise<boolean> {
  if (await matchesRegularFile(path, contents, mode)) return false;

  await withSwapTransaction(
    path,
    'regular-file',
    async ({ staged, install }) => {
      await writeFile(staged, contents, { flag: 'wx' });
      await chmod(staged, mode);
      await install();
    },
  );

  return true;
}

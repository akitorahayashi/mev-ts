import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type RemoveDirectory = (path: string) => Promise<void>;

export interface TemporaryDirectoryOptions {
  readonly prefix?: string;
  readonly root?: string;
  readonly removeDirectory?: RemoveDirectory;
}

function attachCleanupFailure(primary: Error, cleanup: unknown): Error {
  Object.defineProperty(primary, 'cleanupError', {
    configurable: true,
    value: cleanup,
  });
  return primary;
}

export async function withTemporaryDirectory<T>(
  body: (path: string) => Promise<T>,
  options: TemporaryDirectoryOptions = {},
): Promise<T> {
  const dir = await mkdtemp(
    join(options.root ?? tmpdir(), options.prefix ?? 'mev-test-'),
  );
  const removeDirectory =
    options.removeDirectory ??
    ((path) => rm(path, { force: true, recursive: true }));

  let primary: unknown;
  let result: T | undefined;
  try {
    result = await body(dir);
  } catch (error) {
    primary = error;
  }

  try {
    await removeDirectory(dir);
  } catch (cleanup) {
    if (primary !== undefined) {
      if (primary instanceof Error) {
        throw attachCleanupFailure(primary, cleanup);
      }
      throw new AggregateError(
        [primary, cleanup],
        `Failed to remove temporary directory ${dir}.`,
      );
    }
    throw cleanup;
  }
  if (primary !== undefined) throw primary;
  return result as T;
}

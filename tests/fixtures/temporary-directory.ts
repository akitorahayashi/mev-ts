import { test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type RemoveDirectory = (path: string) => Promise<void>;
const noFailure = Symbol('noFailure');

export interface TemporaryDirectoryOptions {
  readonly prefix?: string;
  readonly root?: string;
  readonly removeDirectory?: RemoveDirectory;
}

function attachCleanupFailure(primary: Error, cleanup: unknown): Error {
  Object.defineProperty(primary, 'cleanupError', {
    configurable: true,
    enumerable: true,
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

  let primary: unknown = noFailure;
  let result: T | undefined;
  try {
    result = await body(dir);
  } catch (error) {
    primary = error;
  }

  try {
    await removeDirectory(dir);
  } catch (cleanup) {
    if (primary !== noFailure) {
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
  if (primary !== noFailure) throw primary;
  return result as T;
}

/**
 * A `test` variant that allocates one temporary directory per case (named with
 * `prefix`) and passes it to the body, removing it afterward.
 */
export function sandboxedTest(
  prefix: string,
): (name: string, body: (directory: string) => Promise<void>) => void {
  return (name, body) => {
    test(name, () => withTemporaryDirectory(body, { prefix }));
  };
}

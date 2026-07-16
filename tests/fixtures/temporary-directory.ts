import { test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWithCleanup } from '../../src/host/cleanup-error';

type RemoveDirectory = (path: string) => Promise<void>;

export interface TemporaryDirectoryOptions {
  readonly prefix?: string;
  readonly root?: string;
  readonly removeDirectory?: RemoveDirectory;
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

  return runWithCleanup(
    () => body(dir),
    () => removeDirectory(dir),
    `Failed to remove temporary directory ${dir}.`,
  );
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

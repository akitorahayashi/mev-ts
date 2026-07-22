import {
  copyFile,
  lstat,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { AppError } from '../errors';
import { isNotFound } from '../host/absence';
import { replaceFileAtomically } from '../host/atomic-file';
import { type CommandRunner, formatCommandFailure } from '../host/command';
import { runCapture } from './run';

export async function configGet(
  run: CommandRunner,
  name: string,
): Promise<string | null> {
  const result = await runCapture(run, ['config', '--global', '--get', name]);
  // `git config --get` documents exit code 1 for a missing key: the unset
  // signal. Any other non-zero (e.g. 127 when git is absent) is a broken
  // environment, surfaced rather than masked as unset.
  if (result.code === 1) return null;
  if (result.code !== 0) {
    throw new AppError(
      formatCommandFailure(`git config --global --get ${name} failed`, result),
    );
  }
  return result.stdout.trim();
}

export async function configGetFile(
  run: CommandRunner,
  path: string,
  name: string,
): Promise<string | null> {
  const result = await runCapture(run, [
    'config',
    '--file',
    path,
    '--get',
    name,
  ]);
  if (result.code === 1) return null;
  if (result.code !== 0) {
    throw new AppError(
      formatCommandFailure(
        `git config --file ${path} --get ${name} failed`,
        result,
      ),
    );
  }
  return result.stdout.trim();
}

export async function configSetFileValues(
  run: CommandRunner,
  path: string,
  values: readonly (readonly [string, string])[],
): Promise<void> {
  if (values.length === 0) return;
  const target = await writableConfigTarget(path);
  await replaceFileAtomically(target, async (tmp) => {
    // Seed the staging file from the existing target so unmanaged keys survive
    // the per-value writes; an absent target starts empty.
    try {
      await copyFile(target, tmp);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await writeFile(tmp, '');
    }
    for (const [name, value] of values) {
      const result = await runCapture(run, [
        'config',
        '--file',
        tmp,
        name,
        value,
      ]);
      if (result.code !== 0) {
        throw new AppError(
          formatCommandFailure(
            `git config --file ${tmp} ${name} failed`,
            result,
          ),
        );
      }
    }
  });
}

async function writableConfigTarget(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) return path;
    try {
      return await realpath(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const target = await readlink(path);
      return isAbsolute(target) ? target : resolve(dirname(path), target);
    }
  } catch (error) {
    if (isNotFound(error)) return path;
    throw new AppError(
      `failed to inspect git config at ${path}: ${String(error)}`,
    );
  }
}

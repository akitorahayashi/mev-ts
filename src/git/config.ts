import {
  copyFile,
  lstat,
  mkdir,
  readlink,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { AppError } from '../errors';
import { isNotFound } from '../host/absence';
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

export async function configSetFile(
  run: CommandRunner,
  path: string,
  name: string,
  value: string,
): Promise<void> {
  const result = await runCapture(run, ['config', '--file', path, name, value]);
  if (result.code !== 0) {
    throw new AppError(
      formatCommandFailure(`git config --file ${path} ${name} failed`, result),
    );
  }
}

export async function configSetFileValues(
  run: CommandRunner,
  path: string,
  values: readonly (readonly [string, string])[],
): Promise<void> {
  if (values.length === 0) return;
  const target = await writableConfigTarget(path);
  await mkdir(dirname(target), { recursive: true });
  const stage = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    try {
      await copyFile(target, stage);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await writeFile(stage, '');
    }
    for (const [name, value] of values) {
      const result = await runCapture(run, [
        'config',
        '--file',
        stage,
        name,
        value,
      ]);
      if (result.code !== 0) {
        throw new AppError(
          formatCommandFailure(
            `git config --file ${stage} ${name} failed`,
            result,
          ),
        );
      }
    }
    await rename(stage, target);
  } catch (error) {
    try {
      await unlink(stage);
    } catch (cleanup) {
      if (!isNotFound(cleanup)) {
        (error as Error & { cleanupError?: unknown }).cleanupError = cleanup;
      }
    }
    throw error;
  }
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

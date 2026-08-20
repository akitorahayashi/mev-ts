import {
  copyFile,
  lstat,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
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
    throw new ProvisioningError(
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
    throw new ProvisioningError(
      formatCommandFailure(
        `git config --file ${path} --get ${name} failed`,
        result,
      ),
    );
  }
  return result.stdout.trim();
}

export async function configGetLocal(
  run: CommandRunner,
  cwd: string,
  name: string,
): Promise<string | null> {
  const result = await runCapture(run, [
    '-C',
    cwd,
    'config',
    '--local',
    '--get',
    name,
  ]);
  if (result.code === 1) return null;
  if (result.code !== 0) {
    throw new ProvisioningError(
      formatCommandFailure(
        `git -C ${cwd} config --local --get ${name} failed`,
        result,
      ),
    );
  }
  return result.stdout.trim();
}

/**
 * Writes go through `git config --local` rather than the atomic staging used
 * for the overlay: git takes its own .git/config lock, and in a linked
 * worktree `--local` resolves through the .git file to the shared config — a
 * path we must not compute ourselves. `--replace-all` because a plain set
 * refuses a multi-valued key with exit 5; pinning must converge on one value
 * regardless of how many lines exist.
 */
export async function configSetLocalValues(
  run: CommandRunner,
  cwd: string,
  values: readonly (readonly [string, string])[],
): Promise<void> {
  for (const [name, value] of values) {
    const result = await runCapture(run, [
      '-C',
      cwd,
      'config',
      '--local',
      '--replace-all',
      name,
      value,
    ]);
    if (result.code !== 0) {
      throw new ProvisioningError(
        formatCommandFailure(
          `git -C ${cwd} config --local --replace-all ${name} failed`,
          result,
        ),
      );
    }
  }
}

/**
 * Remove one key from the repository-local config. Returns whether the key
 * existed: git documents exit code 5 for a missing key, the signal that lets
 * idempotent unpinning report honestly. `--unset-all` because plain `--unset`
 * also exits 5 on a multi-valued key — refusing the removal while looking
 * identical to "was absent".
 */
export async function configUnsetLocal(
  run: CommandRunner,
  cwd: string,
  name: string,
): Promise<boolean> {
  const result = await runCapture(run, [
    '-C',
    cwd,
    'config',
    '--local',
    '--unset-all',
    name,
  ]);
  if (result.code === 0) return true;
  if (result.code === 5) return false;
  throw new ProvisioningError(
    formatCommandFailure(
      `git -C ${cwd} config --local --unset-all ${name} failed`,
      result,
    ),
  );
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
        throw new ProvisioningError(
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
    throw new ProvisioningError(
      `failed to inspect git config at ${path}: ${errorMessage(error)}`,
    );
  }
}

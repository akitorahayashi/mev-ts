import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function lstatIfPresent(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readDirentsIfPresent(
  path: string,
): Promise<Dirent[] | null> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readlinkIfPresent(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

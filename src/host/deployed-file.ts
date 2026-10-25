import type { Dirent } from 'node:fs';
import { errorMessage, ProvisioningError } from '../errors';
import { readDirentsIfPresent, readTextIfPresent } from './absence';

function deployFirstMessage(label: string, path: string): string {
  return `${label} not found: ${path}. Run provisioning to deploy it first.`;
}

async function readResource<T>(
  path: string,
  label: string,
  read: () => Promise<T | null>,
): Promise<T> {
  let value: T | null;
  try {
    value = await read();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      'syscall' in error &&
      typeof error.syscall === 'string'
    ) {
      const diagnostic = new ProvisioningError(
        `Failed to read ${label} at ${path}: ${errorMessage(error)}`,
      );
      diagnostic.cause = error;
      throw diagnostic;
    }
    throw error;
  }
  if (value === null)
    throw new ProvisioningError(deployFirstMessage(label, path));
  return value;
}

/**
 * Read a deployed file's text, throwing the canonical deploy-first guidance
 * (named by `label`) when it is absent. Only absence maps to that message; every
 * other read failure keeps its cause rather than being mislabeled as not-found.
 */
export async function readDeployedText(
  path: string,
  label: string,
): Promise<string> {
  return readResource(path, label, () => readTextIfPresent(path));
}

/**
 * Read a deployed directory's entries, throwing the canonical deploy-first
 * guidance (named by `label`) when the directory is absent.
 */
export async function readDeployedDirents(
  path: string,
  label: string,
): Promise<Dirent[]> {
  return readResource(path, label, () => readDirentsIfPresent(path));
}

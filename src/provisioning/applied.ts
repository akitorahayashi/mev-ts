import { unlink } from 'node:fs/promises';
import { errorMessage, ProvisioningError } from '../errors';
import { isNotFound, readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { mevPath, resolveHostPath } from '../host/path';

const signaturePattern = /^sha256:[0-9a-f]{64}$/;

/** The directory holding every target's proof of successful application. */
export function appliedRoot(home: string): string {
  return resolveHostPath(mevPath('applied'), home);
}

export function appliedPath(home: string, target: string): string {
  return resolveHostPath(mevPath('applied', target), home);
}

function validateSignature(signature: string, path: string): string {
  if (!signaturePattern.test(signature)) {
    throw new ProvisioningError(
      `Malformed applied signature at ${path}; expected sha256 followed by 64 lowercase hexadecimal characters.`,
    );
  }
  return signature;
}

export async function readApplied(path: string): Promise<string | null> {
  try {
    const content = await readTextIfPresent(path);
    if (content === null) return null;
    if (
      !content.endsWith('\n') ||
      content.indexOf('\n') !== content.length - 1
    ) {
      throw new ProvisioningError(
        `Malformed applied signature at ${path}; expected one newline-terminated value.`,
      );
    }
    return validateSignature(content.slice(0, -1), path);
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError(
      `Failed to read applied signature at ${path}: ${errorMessage(error)}`,
    );
  }
}

export async function invalidateApplied(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (isNotFound(error)) return;
    throw new ProvisioningError(
      `Failed to invalidate applied signature at ${path}: ${errorMessage(error)}`,
    );
  }
}

export async function writeApplied(
  path: string,
  signature: string,
): Promise<void> {
  validateSignature(signature, path);
  try {
    await writeFileAtomically(path, `${signature}\n`);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to write applied signature at ${path}: ${errorMessage(error)}`,
    );
  }
}

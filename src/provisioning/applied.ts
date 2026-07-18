import { join } from 'node:path';
import { errorMessage, ProvisioningError } from '../errors';
import { readTextIfPresent } from '../host/absence';
import { writeFileAtomically } from '../host/atomic-file';
import { mevRoot } from '../host/path';

const signaturePattern = /^sha256:[0-9a-f]{64}$/;

/** Resolve the successful-signature file owned by one canonical target. */
export function appliedPath(home: string, target: string): string {
  return join(home, mevRoot, 'applied', target);
}

function validateSignature(signature: string, path: string): string {
  if (!signaturePattern.test(signature)) {
    throw new ProvisioningError(
      `Malformed applied signature at ${path}; expected sha256 followed by 64 lowercase hexadecimal characters.`,
    );
  }
  return signature;
}

/** Read a target's last successful signature, or null when none exists. */
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

/** Persist a target's successful signature through an atomic replacement. */
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

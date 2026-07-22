import { ProvisioningError } from '../errors';
import { readTextIfPresent } from './absence';

/** The canonical guidance surfaced when a file mev expects to be deployed is absent. */
function deployFirstMessage(label: string, path: string): string {
  return `${label} not found: ${path}. Run provisioning to deploy it first.`;
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
  const raw = await readTextIfPresent(path);
  if (raw === null) {
    throw new ProvisioningError(deployFirstMessage(label, path));
  }
  return raw;
}

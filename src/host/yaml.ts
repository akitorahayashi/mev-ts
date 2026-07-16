import { dump, load } from 'js-yaml';
import { errorMessage, ProvisioningError } from '../errors';

/**
 * Parse YAML, mapping a syntax failure to a labeled `ProvisioningError` naming
 * `source` (mirroring the JSON parse-error handling elsewhere) so a hand-edited
 * manifest surfaces through the error taxonomy rather than leaking js-yaml's
 * `YAMLException` as an uncaught stack trace.
 */
export function loadYaml(raw: string, source: string): unknown {
  try {
    return load(raw);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse YAML: ${source}. ${errorMessage(error)}`,
    );
  }
}

export function dumpYaml(value: unknown): string {
  return dump(value);
}

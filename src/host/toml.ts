import { parse, stringify } from 'smol-toml';
import { errorMessage, ProvisioningError } from '../errors';

/**
 * Parse TOML, mapping a syntax failure to a labeled `ProvisioningError` naming
 * `source` (mirroring `loadYaml`) so a hand-edited or tool-corrupted file
 * surfaces through the error taxonomy rather than leaking smol-toml's error as
 * an uncaught stack trace.
 */
export function loadToml(raw: string, source: string): Record<string, unknown> {
  try {
    return parse(raw);
  } catch (error) {
    throw new ProvisioningError(
      `Failed to parse TOML: ${source}. ${errorMessage(error)}`,
    );
  }
}

export function serializeToml(value: Record<string, unknown>): string {
  return `${stringify(value)}\n`;
}
